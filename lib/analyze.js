/**
 * analyze.js — the pipeline, in the order a content specialist would work.
 *
 *   read the listing → build a verified fact sheet → rank the USPs →
 *   understand the guest → generate names → check accuracy → check length →
 *   score → recommend one
 *
 * Reading the listing is itself a chain of strategies (see extract.js): HTML,
 * JSON, embedded JSON, an OTA-specific pass, then browser rendering. The manual
 * paste path is only offered once every one of those has failed.
 *
 * Every stage fails softly: a listing that yields only some fields produces a
 * smaller fact sheet and fewer names — never a guess.
 */

import { normalizeUrl, detectOta, listingId } from './ota.js';
import { extractFromUrl, merge } from './extract.js';
import { parseListing, parseText } from './parsers/index.js';
import { countFields } from './parsers/json.js';
import { buildFacts } from './facts.js';
import { rankUsps } from './usp.js';
import { generateNames, clampLimit, STYLES, nameSlots } from './names.js';
import { OTA_PROFILES, candidatesFor, fitForProfile, rationaleFor } from './otastyle.js';
import { buildVocabulary, validateName } from './validate.js';
import { scoreName, pickBest } from './score.js';
import { llmStatus, suggestNames } from './llm.js';
import { createTrace } from './log.js';
import { captureStatus } from './capture.js';

export async function analyze(input = {}) {
  const limit = clampLimit(input.maxChars);
  const overrides = input.overrides || {};
  const pasted = typeof input.pastedText === 'string' ? input.pastedText.trim() : '';
  const warnings = [];

  const normalized = normalizeUrl(input.url || '');
  if (!normalized.ok && !pasted) {
    return { ok: false, stage: 'url', error: normalized.error, limit };
  }

  const url = normalized.ok ? normalized.url : null;
  const ota = url ? detectOta(url) : { id: 'unknown', label: 'Manual entry', supported: false };
  if (url && !ota.supported) {
    warnings.push(`${ota.label} is not one of the five supported OTAs — generic extraction was used, so check the fields below.`);
  }

  /* ------------------------------------------------------- read the listing */

  let extraction = null;
  let signals = null;

  if (url && !input.pastedOnly) {
    extraction = await extractFromUrl({
      url,
      ota: ota.id,
      allowRender: input.useRender !== false,
      useCapture: input.useCapture !== false,
    });
    signals = extraction.signals;
  }

  if (pasted) {
    // Page source gets the full structured extraction; prose gets the text
    // pipeline. Either way the facts are sourced `manual`.
    const isHtml = looksLikeHtml(pasted);
    const manualSignals = isHtml
      ? parseListing({ html: pasted, url: url || '', ota: ota.id })
      : parseText({ text: pasted, url: url || '', ota: ota.id });
    manualSignals.sources = { ...manualSignals.sources, manual: true };
    signals = merge(signals, manualSignals);
    if (extraction && extraction.trace) {
      // Record the paste alongside the routes that were tried on the URL.
      extraction.trace.steps.push({
        strategy: 'pasted',
        label: isHtml ? 'Pasted page source' : 'Pasted details',
        status: 'success',
        fields: countFields(manualSignals),
        note: null,
      });
      extraction.trace.fields = countFields(signals);
    }
    if (!extraction) {
      const trace = createTrace({ ota: ota.label, url });
      trace.responseKind(isHtml ? 'pasted page source' : 'pasted text', null, pasted.length);
      trace.step('pasted', 'success', { fields: countFields(manualSignals) });
      trace.finish(countFields(manualSignals));
      extraction = { trace: trace.toJSON(), blocked: null, fetched: null };
    }
  }

  const fields = countFields(signals);
  if (!signals || fields === 0) {
    return unreadable({ extraction, ota, url, limit, pasted });
  }

  /* ------------------------------------------------------------- analyse it */

  const facts = buildFacts(signals, overrides);
  facts.listingId = url ? listingId(url, ota.id) : null;

  const foundNothing = !facts.name && !facts.location && !facts.bedrooms && !facts.usps.length;
  if (foundNothing) {
    return unreadable({ extraction, ota, url, limit, pasted });
  }

  const ranking = rankUsps(facts);

  if (facts.coverage.partial) {
    warnings.push(`Partial listing information available — not found: ${facts.coverage.missing.join(', ')}. Names use only what was verified.`);
  }
  if (!ranking.titleUsps.length) {
    warnings.push('No strong title USP was found on this listing. Add one under "Additional USP" if you know of a feature the listing does not mention.');
  }
  if (extraction && extraction.needsCapture) {
    const detail = extraction.blocked ? extraction.blocked.message : 'The listing page could not be read.';
    warnings.push(`${detail} Only what the URL itself carries was read, so amenities, layout and USPs are missing — open the listing in your browser and use "Capture from my browser" below to complete the analysis.`);
  }
  if (extraction && extraction.captured) {
    warnings.push('Analysed from the page your browser captured. Check the fields below against what you saw.');
  }
  const renderedStep = extraction && extraction.trace
    ? extraction.trace.steps.find((s) => s.strategy === 'render' && s.status === 'success')
    : null;
  if (renderedStep) {
    warnings.push('This listing is built in the browser, so it was read by rendering the page locally — worth a quick check of the extracted fields.');
  }

  /* ---------------------------------------------------------------- name it */

  const vocabulary = buildVocabulary(facts, ranking);
  const candidates = generateNames(facts, ranking, { maxChars: limit });

  const ai = { enabled: llmStatus().enabled, used: false, model: llmStatus().model, error: null, rejected: [] };
  if (ai.enabled && input.useAi !== false) {
    try {
      const result = await suggestNames({ facts, ranking, limit });
      ai.used = true;
      ai.model = result.model;
      ai.usage = result.usage || null;
      if (result.refused) ai.error = 'Claude declined this request; engine names are shown.';
      for (const proposal of result.names) {
        candidates.push({
          name: proposal.name,
          style: STYLES[proposal.style] ? proposal.style : 'usp',
          styleLabel: STYLES[proposal.style] || 'USP Focused',
          length: proposal.name.length,
          limit,
          rationale: proposal.rationale,
          origin: 'ai',
        });
      }
    } catch (err) {
      ai.error = err && err.message ? err.message : 'The Claude enhancement pass failed.';
    }
  }

  const scored = [];
  const rejected = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const validation = validateName(candidate.name, facts, ranking, limit, vocabulary);
    if (!validation.ok) {
      rejected.push({ name: candidate.name, origin: candidate.origin, reasons: validation.violations.map((v) => v.message) });
      continue;
    }
    const scoring = scoreName(candidate, facts, ranking, limit, validation);
    scored.push({ ...candidate, length: candidate.name.length, score: scoring.score, scoring, validation });
  }

  ai.rejected = rejected.filter((r) => r.origin === 'ai');
  if (ai.used && ai.rejected.length) {
    warnings.push(`${ai.rejected.length} AI suggestion${ai.rejected.length > 1 ? 's were' : ' was'} discarded for claiming something the listing does not confirm.`);
  }

  scored.sort((a, b) => b.score - a.score || a.length - b.length);
  const best = pickBest(scored);
  const others = scored.filter((n) => n !== best).slice(0, 14);
  const options = buildOptions(scored, best, ranking);
  const perOta = buildPerOtaNames(facts, ranking, vocabulary, limit);

  const fetched = extraction ? extraction.fetched : null;
  return {
    ok: true,
    limit,
    url,
    finalUrl: fetched && fetched.ok ? fetched.finalUrl : url,
    ota: publicOta(ota),
    fetch: fetched
      ? {
        ok: fetched.ok,
        status: fetched.status,
        bytes: fetched.bytes || 0,
        contentType: fetched.contentType || null,
        reason: fetched.reason || null,
        message: fetched.message || null,
      }
      : { ok: false, status: 0, bytes: 0, contentType: null, reason: 'manual', message: 'Details entered manually.' },
    extraction: extraction ? extraction.trace : null,
    needsCapture: Boolean(extraction && extraction.needsCapture),
    captureUsed: Boolean(extraction && extraction.captured),
    capture: url ? captureOffer(url, extraction) : null,
    manualUsed: Boolean(pasted),
    analysis: publicFacts(facts),
    usps: {
      ranked: ranking.ranked.map(publicUsp),
      titleUsps: ranking.titleUsps.map(publicUsp),
      commodities: ranking.commodities.map(publicUsp),
      unconfirmed: (ranking.unconfirmed || []).map(publicUsp),
    },
    best: best || null,
    /** Five structurally different titles, the recommended one first. */
    options,
    /** One title per OTA, written for that platform's audience and UI. */
    otaNames: perOta,
    recommendation: best ? recommendation(best, facts, ranking) : null,
    names: others,
    totalNames: scored.length,
    rejected,
    ai,
    warnings,
  };
}

/* -------------------------------------------------------- per-OTA titles */

/**
 * A title for each OTA. Each platform's own candidates are tried in order and
 * the first one that clears the accuracy gate, its own character ceiling and
 * the user's limit wins — so a platform never gets a title that claims more
 * than the property page confirms.
 */
function buildPerOtaNames(facts, ranking, vocabulary, limit) {
  const slots = nameSlots(facts, ranking);
  const out = [];

  for (const profile of OTA_PROFILES) {
    const ceiling = Math.min(profile.maxChars, limit);
    const tried = [];
    let chosen = null;

    for (const raw of candidatesFor(profile, slots)) {
      const fitted = fitForProfile(raw, { ...profile, maxChars: ceiling });
      if (!fitted) {
        tried.push({ name: raw, reason: `could not be brought under ${ceiling} characters` });
        continue;
      }
      const validation = validateName(fitted.name, facts, ranking, ceiling, vocabulary);
      if (!validation.ok) {
        tried.push({ name: fitted.name, reason: validation.violations.map((v) => v.message).join('; ') });
        continue;
      }
      const scoring = scoreName({ name: fitted.name }, facts, ranking, ceiling, validation);
      chosen = {
        ota: profile.id,
        label: profile.label,
        glyph: profile.glyph,
        accent: profile.accent,
        audience: profile.audience,
        convention: profile.convention,
        name: fitted.name,
        length: fitted.name.length,
        limit: ceiling,
        score: scoring.score,
        mainUsp: mainUspOf(fitted.name, ranking),
        trimmed: fitted.trimmed,
        why: rationaleFor(profile, fitted.name, slots),
      };
      break;
    }

    out.push(chosen || {
      ota: profile.id,
      label: profile.label,
      glyph: profile.glyph,
      accent: profile.accent,
      audience: profile.audience,
      convention: profile.convention,
      name: null,
      limit: ceiling,
      why: tried.length
        ? `No wording for ${profile.label} passed the checks: ${tried[0].reason}`
        : `Not enough confirmed detail to write a ${profile.label} title.`,
    });
  }
  return out;
}

function mainUspOf(name, ranking) {
  const lower = name.toLowerCase();
  const included = (ranking.titleUsps || []).filter((usp) => {
    const label = (usp.label || '').toLowerCase();
    const short = (usp.short || '').toLowerCase();
    return (label && lower.includes(label)) || (short && lower.includes(short));
  });
  const top = included.slice().sort((x, y) => y.strength - x.strength)[0];
  return top ? top.label : 'Property name and location';
}

/* ------------------------------------------------------------ name options */

/**
 * Five titles that differ in *structure*, not just wording — the brief asks for
 * options a listing manager can choose between, so the best of each structure
 * earns a slot before a second variation of an existing one does.
 */
function buildOptions(scored, best, ranking, wanted = 5) {
  const options = [];
  const used = new Set();
  const take = (candidate) => {
    if (!candidate || used.has(candidate.name)) return;
    used.add(candidate.name);
    options.push(describeOption(candidate, ranking));
  };

  take(best);

  const byStructure = new Map();
  for (const candidate of scored) {
    const key = candidate.structure || candidate.styleLabel || 'other';
    if (!byStructure.has(key)) byStructure.set(key, candidate);
  }
  for (const candidate of byStructure.values()) {
    if (options.length >= wanted) break;
    take(candidate);
  }

  // Still short (a sparse listing yields few templates) — fill with the next
  // best names rather than showing fewer than asked for.
  for (const candidate of scored) {
    if (options.length >= wanted) break;
    take(candidate);
  }
  return options.slice(0, wanted);
}

function describeOption(candidate, ranking) {
  const lower = candidate.name.toLowerCase();
  const included = (ranking.titleUsps || []).filter((usp) => {
    const label = (usp.label || '').toLowerCase();
    const short = (usp.short || '').toLowerCase();
    return (label && lower.includes(label)) || (short && lower.includes(short));
  });
  const mainUsp = included.slice().sort((x, y) => y.strength - x.strength)[0] || null;

  return {
    name: candidate.name,
    length: candidate.name.length,
    limit: candidate.limit,
    score: candidate.score,
    structure: candidate.structure || candidate.styleLabel,
    style: candidate.style,
    styleLabel: candidate.styleLabel,
    origin: candidate.origin,
    mainUsp: mainUsp ? mainUsp.label : 'Property name and location',
    secondaryUsps: included.filter((u) => u !== mainUsp).map((u) => u.label).slice(0, 2),
    reasons: candidate.scoring ? candidate.scoring.reasons : [],
  };
}

/** One sentence on why the recommended title is the one to publish. */
function recommendation(best, facts, ranking) {
  const bits = [];
  const top = (ranking.titleUsps || [])[0];
  if (facts.bedrooms && new RegExp(`\\b${facts.bedrooms.value}\\s?BHK`, 'i').test(best.name)) {
    bits.push(`states the ${facts.bedrooms.value}BHK size a group searches by`);
  }
  if (top && new RegExp(top.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(best.name)) {
    bits.push(`leads with ${top.label}, the strongest feature the page confirms`);
  } else if (top && top.short && new RegExp(top.short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(best.name)) {
    bits.push(`carries ${top.label} (as "${top.short}"), the strongest feature the page confirms`);
  }
  if (facts.location && best.name.toLowerCase().includes(facts.location.value.toLowerCase())) {
    bits.push(`names ${facts.location.value} so it surfaces in destination searches`);
  }
  if (facts.brand && best.name.toLowerCase().includes(facts.brand.value.toLowerCase())) {
    bits.push(`keeps the ${facts.brand.value} name guests may already recognise`);
  }
  bits.push(`fits in ${best.name.length} of ${best.limit} characters`);

  return {
    name: best.name,
    length: best.name.length,
    limit: best.limit,
    score: best.score,
    structure: best.structure || best.styleLabel,
    why: `This one ${joinList(bits)}.`,
    reasons: best.scoring ? best.scoring.reasons : [],
  };
}

function joinList(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* -------------------------------------------------------- failure response */

/** Only reached when every extraction strategy came back empty. */
function unreadable({ extraction, ota, url, limit, pasted }) {
  const trace = extraction ? extraction.trace : null;
  const blocked = extraction ? extraction.blocked : null;
  const fetched = extraction ? extraction.fetched : null;

  let detail;
  let reason;
  if (pasted) {
    detail = 'Nothing usable could be read from what you pasted.';
    reason = 'pasted-empty';
  } else if (blocked && blocked.reason === 'stub') {
    detail = blocked.message;
    reason = 'stub';
  } else if (blocked) {
    detail = blocked.message;
    reason = 'blocked';
  } else if (fetched && !fetched.ok) {
    detail = fetched.message;
    reason = fetched.reason;
  } else {
    detail = 'Every extraction route ran, but none of them found listing fields on this page.';
    reason = 'no-fields';
  }

  return {
    ok: false,
    stage: 'extract',
    error: 'Unable to read this property listing.',
    detail,
    reason,
    otaNote: extraction && extraction.adapter ? extraction.adapter.note : null,
    strategies: trace ? trace.steps : [],
    extraction: trace,
    hint: url
      ? 'Open the listing in your browser and use "Capture from my browser" below — or paste the visible page text.'
      : 'Paste the property description and details below.',
    needsCapture: Boolean(url),
    capture: url ? captureOffer(url, extraction) : null,
    ota: publicOta(ota),
    url,
    limit,
  };
}

/**
 * What the dashboard needs to offer the browser-capture route: the listing to
 * open, and whether a capture for it has already arrived.
 */
function captureOffer(url, extraction) {
  return {
    supported: true,
    listingUrl: url,
    status: captureStatus(url),
    reason: extraction && extraction.blocked ? extraction.blocked.reason : null,
  };
}

/* ----------------------------------------------------------------- shaping */

function publicOta(ota) {
  return { id: ota.id, label: ota.label, supported: Boolean(ota.supported) };
}

function publicUsp(usp) {
  return {
    id: usp.id,
    label: usp.label,
    short: usp.short,
    category: usp.category,
    strength: usp.strength,
    titleWorthy: usp.titleWorthy,
    source: usp.source,
    evidence: usp.evidence,
    reasons: usp.reasons || [],
    confirmed: usp.confirmed !== false,
    manual: usp.source === 'manual-added',
  };
}

function publicFacts(facts) {
  const field = (f, extra = {}) => (f ? { value: f.value, source: f.source, evidence: f.evidence || null, ...extra } : null);
  return {
    name: field(facts.name),
    brand: field(facts.brand),
    propertyType: field(facts.propertyType),
    location: field(facts.location),
    bedrooms: field(facts.bedrooms),
    bathrooms: field(facts.bathrooms),
    guests: field(facts.guests),
    beds: field(facts.beds),
    rating: field(facts.rating),
    reviewCount: field(facts.reviewCount),
    description: facts.description
      ? { value: truncate(facts.description.value, 900), source: facts.description.source }
      : null,
    luxury: facts.luxury && facts.luxury.value ? { value: true, evidence: facts.luxury.evidence } : null,
    guestFit: facts.guestFit,
    coverage: facts.coverage,
    amenityCount: facts.amenityCount,
    removedUsps: facts.removedUsps || [],
    listingId: facts.listingId || null,
    sources: facts.sources,
  };
}

/** Distinguishes a pasted page source from pasted prose. */
function looksLikeHtml(text) {
  return text.length > 400 && /<(?:!doctype|html|head|meta|script|div|body)\b/i.test(text.slice(0, 4000));
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
}
