/**
 * extract.js — get listing signals out of a URL by trying every route in turn.
 *
 *   0. Browser capture         → content the user's own browser already showed
 *   1. HTML response           → parse the markup
 *   2. JSON response           → mine the API payload by key name
 *   3. Embedded JSON in HTML   → JSON-LD, Next.js data, Redux/app state
 *   4. OTA-specific pass       → the adapter's own script selectors, and any
 *                                large embedded blob run through the JSON parser
 *   5. Browser rendering       → run the page's own client-side app
 *   6. URL metadata            → the property name and city in the listing path
 *
 * Each route contributes what it can and the results are merged, so a name from
 * the URL and a layout from a capture end up on the same fact sheet. The chain
 * stops early once enough fields are in hand.
 *
 * Two things it will not do. It never tries to satisfy a gate: a bot-protection
 * challenge, CAPTCHA or login wall ends the chain. And it never repeats a
 * request that has already proved pointless — an OTA that answers with a
 * byte-sized placeholder gets one attempt, then the chain moves on to the
 * routes that can actually work.
 */

import { fetchListing } from './fetcher.js';
import { parseListing } from './parsers/index.js';
import { parseStayVista } from './parsers/stayvista.js';
import { parseJson, countFields } from './parsers/json.js';
import { adapterFor, isStubResponse } from './parsers/adapters.js';
import { extractScriptJson, extractJsonLd, tryParseJson } from './html.js';
import { renderPage, renderStatus } from './render.js';
import {
  findCapture, captureToHtml, captureKey, clearCapture, trustedSection, amenityLines,
} from './capture.js';
import { factsFromUrl } from './urlfacts.js';
import { createTrace } from './log.js';

/** Enough of a listing to write names from; below this, keep trying. */
const ENOUGH_FIELDS = 4;

/**
 * URLs this process has already seen answer with a placeholder. Re-analysing
 * one skips the fetch and render routes instead of repeating them.
 */
const knownStubs = new Set();

export async function extractFromUrl({ url, ota, allowRender = true, useCapture = true }) {
  const adapter = adapterFor(ota);
  const trace = createTrace({ ota: adapter.label, url });
  const key = captureKey(url);

  let signals = null;
  let fetched = null;
  let blocked = null;
  let captured = false;

  /* ------------------------------------------- route 0: the user's browser */

  const capture = useCapture ? findCapture(url) : null;
  if (capture && !capture.looseMatch) {
    const captureSignals = parseListing({ html: captureToHtml(capture), url, ota });
    const fields = countFields(captureSignals);
    if (fields) {
      captureSignals.sources = { ...captureSignals.sources, capture: true };
      trustCapturedSection(captureSignals, capture);
      signals = merge(signals, captureSignals);
      captured = true;
      const kb = Math.round(((capture.text || '').length + (capture.main || '').length) / 1024);
      trace.step('capture', 'success', { fields, note: `${kb} KB captured in your browser` });
    } else {
      trace.step('capture', 'failed', { note: 'the captured page held no listing fields' });
    }
  }

  /* --------------------------------------------- routes 1-3: a single fetch */

  if (captured && countFields(signals) >= ENOUGH_FIELDS) {
    trace.step('fetch', 'skipped', { note: 'the browser capture already had the listing' });
  } else if (knownStubs.has(key)) {
    trace.step('fetch', 'skipped', {
      note: `${adapter.label} answered this URL with a placeholder earlier in this session — not retried`,
    });
    blocked = { reason: 'stub', message: placeholderMessage(adapter) };
  } else {
    fetched = await fetchListing(url);
    trace.responseKind(fetched.contentType, fetched.status, fetched.bytes);

    if (!fetched.ok) {
      trace.step('fetch', 'failed', { note: fetched.message });
      if (fetched.reason === 'blocked' || fetched.reason === 'login-required') blocked = fetched;
    } else {
      trace.step('fetch', 'success', { note: `${fetched.kind} response` });

      if (fetched.kind === 'json') {
        trace.step('html', 'skipped', { note: 'response was JSON, not markup' });
        const result = parseJson({ body: fetched.html, url: fetched.finalUrl, ota });
        if (result.ok) {
          signals = merge(signals, result.signals);
          trace.step('json', 'success', { fields: result.fieldCount });
        } else {
          trace.step('json', 'failed', { note: result.message });
          if (result.reason === 'stub') {
            knownStubs.add(key);
            blocked = { reason: 'stub', message: result.message };
          }
        }
      } else if (isStubResponse(fetched.html, adapter)) {
        const note = `${adapter.label} returned a ${fetched.html.trim().length}-byte placeholder instead of the listing.`;
        trace.step('html', 'failed', { note });
        knownStubs.add(key);
        blocked = { reason: 'stub', message: note };
      } else {
        // StayVista is the source of truth and has its own reader, which also
        // honours the amenities the page lists as unavailable.
        const htmlSignals = ota === 'stayvista'
          ? parseStayVista({ html: fetched.html, url: fetched.finalUrl })
          : parseListing({ html: fetched.html, url: fetched.finalUrl, ota });
        const fields = countFields(htmlSignals);
        const hadEmbedded = Boolean(htmlSignals.sources && htmlSignals.sources.embedded);
        if (fields) {
          signals = merge(signals, htmlSignals);
          trace.step('html', 'success', { fields });
        } else {
          trace.step('html', 'failed', { note: 'markup held no listing fields' });
        }
        trace.step('embedded', hadEmbedded ? 'success' : 'failed', {
          note: hadEmbedded ? 'app-state payload found in the page' : 'no embedded app state in the page',
        });
      }
    }
  }

  /* ----------------------------------------- route 4: OTA-specific payloads */

  if (fetched && fetched.ok && fetched.kind !== 'json' && countFields(signals) < ENOUGH_FIELDS && !blocked) {
    const otaResult = otaSpecificPass(fetched.html, fetched.finalUrl, ota, adapter);
    if (otaResult.ok) {
      signals = merge(signals, otaResult.signals);
      trace.step('ota', 'success', { fields: otaResult.fieldCount, note: otaResult.note });
    } else {
      trace.step('ota', 'failed', { note: otaResult.message });
    }
  }

  /* --------------------------------------------------- route 5: rendering */

  const render = renderStatus();
  const needsRender = countFields(signals) < ENOUGH_FIELDS;
  if (!needsRender) {
    trace.step('render', 'skipped', {
      note: captured ? 'the capture already had the listing' : 'not needed — the page was readable directly',
    });
  } else if (blocked && blocked.reason === 'stub') {
    // Measured: these OTAs hand the same placeholder to a real browser, so
    // rendering the same URL again cannot help. Offer the capture route instead.
    trace.step('render', 'skipped', {
      note: `${adapter.label} serves the same placeholder to a real browser, so rendering the same URL cannot help — the browser-capture route is offered instead`,
    });
  } else if (blocked) {
    trace.step('render', 'skipped', {
      note: 'the listing is behind a bot-protection or sign-in gate, which this tool does not attempt to pass',
    });
  } else if (!allowRender) {
    trace.step('render', 'skipped', { note: 'rendering was switched off for this request' });
  } else if (!render.available) {
    trace.step('render', 'skipped', { note: render.disabled ? 'OTA_RENDER=0' : 'no local Chrome or Edge found' });
  } else {
    const rendered = await renderPage(url);
    if (rendered.ok) {
      const renderedSignals = parseListing({ html: rendered.html, url: rendered.finalUrl, ota });
      const fields = countFields(renderedSignals);
      if (fields) {
        signals = merge(signals, renderedSignals);
        trace.step('render', 'success', { fields, note: `${render.binary}, ${Math.round(rendered.bytes / 1024)} KB rendered` });
      } else if (isStubResponse(rendered.html, adapter)) {
        const note = `${adapter.label} served the same placeholder to a real browser — the listing is not in the response at all.`;
        trace.step('render', 'failed', { note });
        knownStubs.add(key);
        blocked = blocked || { reason: 'stub', message: note };
      } else {
        trace.step('render', 'failed', { note: 'the rendered page held no listing fields' });
      }
    } else {
      trace.step('render', 'failed', { note: rendered.message });
      if (rendered.reason === 'blocked') blocked = { reason: 'blocked', message: rendered.message };
      if (rendered.reason === 'stub') {
        knownStubs.add(key);
        blocked = {
          reason: 'stub',
          message: `${blocked && blocked.message ? `${blocked.message} ` : ''}Rendering it in a local browser returned the same placeholder, so ${adapter.label} is not serving this listing to anything outside its own site.`,
        };
      }
    }
  }

  /* ------------------------------------ route 6: the URL itself, as a floor */

  const urlFacts = factsFromUrl(url, ota);
  if (urlFacts.ok) {
    // Merged last, so anything read from the page keeps precedence.
    signals = merge(signals, urlFacts.signals);
    trace.step('url', 'success', { fields: urlFacts.fields, note: 'property name and city read from the listing path' });
  } else {
    trace.step('url', 'failed', { note: urlFacts.note });
  }

  const fields = countFields(signals);
  trace.finish(fields);

  return {
    ok: Boolean(signals) && fields > 0,
    signals,
    fields,
    fetched,
    blocked,
    captured,
    looseCapture: Boolean(capture && capture.looseMatch),
    /** True when the page itself could not be read and a capture would fix it. */
    needsCapture: !captured && Boolean(blocked),
    adapter: { id: adapter.id, label: adapter.label, note: adapter.note },
    trace: trace.toJSON(),
  };
}

/**
 * A captured page is the user looking at the listing, so the property's own
 * section counts as the listing describing itself — the same standing as a
 * description read from markup. The rest of the captured page stays in the page
 * zone, because an OTA page also advertises other properties.
 */
function trustCapturedSection(signals, capture) {
  const own = trustedSection(capture);
  if (own) {
    signals.zones = [...(signals.zones || []), { kind: 'capture', text: own }];
    signals.typeCandidates = [...(signals.typeCandidates || []), { text: own, source: 'capture' }];
  }

  const amenities = amenityLines(capture);
  if (amenities.length) {
    signals.amenityStrings = dedupe([...(signals.amenityStrings || []), ...amenities]).slice(0, 400);
    signals.zones = [...(signals.zones || []), { kind: 'amenity-list', text: amenities.join('. ') }];
  }

  signals.trustedText = signals.zones.map((z) => z.text).join('\n');
  signals.haystack = [signals.trustedText, signals.pageText || ''].filter(Boolean).join('\n');
}

/** Forget a consumed capture so a later analysis reads a fresh one. */
export function dropCapture(url) {
  clearCapture(url);
}

export function isKnownStub(url) {
  return knownStubs.has(captureKey(url));
}

function placeholderMessage(adapter) {
  return `${adapter.label} answers this URL with a short placeholder instead of the listing, and does the same for a real browser.`;
}

/* ------------------------------------------------------- route 4 in detail */

/**
 * Runs the adapter's own script selectors, and pushes every sizeable embedded
 * blob through the JSON parser. This is what catches app state the generic HTML
 * pass does not know the shape of — Booking's capla payloads, a Redux store, an
 * unfamiliar OTA's `__INITIAL_STATE__`.
 */
function otaSpecificPass(html, url, ota, adapter) {
  const blobs = [];
  for (const selector of adapter.embeddedSelectors || []) {
    blobs.push(...extractScriptJson(html, selector));
  }
  blobs.push(...extractScriptJson(html, /type=["']application\/json["']/i));
  for (const node of extractJsonLd(html)) blobs.push(node);
  for (const assignment of stateAssignments(html)) blobs.push(assignment);

  if (!blobs.length) {
    return { ok: false, message: 'no OTA-specific payload found in the page' };
  }

  let best = null;
  for (const blob of blobs.slice(0, 24)) {
    const result = parseJson({ body: '', json: blob, url, ota });
    if (result.ok && (!best || result.fieldCount > best.fieldCount)) best = result;
  }
  if (!best) {
    return { ok: false, message: `${blobs.length} payload(s) inspected, none held listing fields` };
  }
  return { ...best, note: `mined ${blobs.length} embedded payload(s)` };
}

/** `window.__INITIAL_STATE__ = {...}` style assignments inside inline scripts. */
function stateAssignments(html) {
  const out = [];
  const re = /(?:window|self)\.(?:__INITIAL_STATE__|__PRELOADED_STATE__|__NUXT__|__APP_STATE__|initialData|pageData)\s*=\s*(\{[\s\S]{200,400000}?\})\s*[;<]/g;
  let match;
  while ((match = re.exec(html)) !== null && out.length < 6) {
    const parsed = tryParseJson(match[1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

/* ---------------------------------------------------------------- merging */

/**
 * Later routes fill gaps rather than overwrite: a fact already found by a
 * stronger source keeps its provenance, and text pools are unioned so USP
 * matching sees everything that was read.
 */
export function merge(base, next) {
  if (!base) return next;
  if (!next) return base;

  const merged = { ...base };
  merged.sources = { ...(base.sources || {}), ...(next.sources || {}) };

  for (const key of ['name', 'description', 'location', 'rating', 'reviewCount',
    'bedrooms', 'bathrooms', 'guests', 'beds', 'propertyTypeExact']) {
    if (!merged[key] && next[key]) merged[key] = next[key];
  }

  merged.amenityStrings = dedupe([...(base.amenityStrings || []), ...(next.amenityStrings || [])]).slice(0, 400);
  merged.deniedTerms = dedupe([...(base.deniedTerms || []), ...(next.deniedTerms || [])]).slice(0, 120);
  merged.nearby = dedupe([...(base.nearby || []), ...(next.nearby || [])]).slice(0, 60);
  merged.text = longest(base.text, next.text);

  // Zones concatenate, so a description found by one route and an amenity list
  // found by another are both trusted, each keeping its own source.
  merged.zones = dedupeZones([...(base.zones || []), ...(next.zones || [])]);
  merged.trustedText = merged.zones.map((z) => z.text).join('\n');
  merged.pageText = joinUnique(base.pageText, next.pageText);
  merged.haystack = [merged.trustedText, merged.pageText].filter(Boolean).join('\n');
  merged.typeCandidates = [...(base.typeCandidates || []), ...(next.typeCandidates || [])]
    .filter((c) => c && c.text);
  merged.typeHint = joinUnique(base.typeHint, next.typeHint);
  return merged;
}

function dedupeZones(zones) {
  const seen = new Set();
  const out = [];
  for (const zone of zones) {
    const text = zone && zone.text ? String(zone.text).trim() : '';
    if (!text) continue;
    const key = `${zone.kind}::${text.slice(0, 200).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: zone.kind, text });
  }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item).toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function longest(a, b) {
  const first = a || '';
  const second = b || '';
  return second.length > first.length ? second : first;
}

function joinUnique(a, b) {
  if (!a) return b || '';
  if (!b || a.includes(b)) return a;
  return `${a}\n${b}`;
}
