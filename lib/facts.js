/**
 * facts.js — normalise raw page signals into the verified fact sheet that the
 * rest of the tool is allowed to use.
 *
 * The contract: if it is not in here, no generated name may claim it. Manual
 * corrections from the user are merged in with source `manual`, which the spec
 * treats as an equally valid source of truth.
 */

import { USP_CATALOG, PROPERTY_TYPES, LUXURY_EVIDENCE } from './knowledge.js';
import { clean } from './html.js';

/**
 * Proximity language. A listing that is "10 minutes from the beach" is not
 * beachfront, and an area guide describing "a restored 18th-century farmhouse
 * nearby" does not make this property a farmhouse. These markers invalidate
 * *setting* claims — where the property is and what it looks out on — but not
 * amenity claims, since a pool mentioned in the same sentence as a landmark is
 * still the property's pool.
 */
const AREA_MARKERS = /\b(?:near(?:by|est|est)?|close\s+to|minutes?\s+(?:away|from|drive|walk)|mins?\s+(?:away|from)|\d+\s*(?:km|kms|kilometres|kilometers|miles|mi)\s*(?:from|away)|walking\s+distance|short\s+drive|in\s+the\s+area|the\s+area(?:'|\u2019)?s|surrounding\s+area|neighbou?rhood|explore|sightseeing|attractions?|landmarks?|must[-\s]see|things\s+to\s+do|day\s+trip|excursion)\b/i;

/**
 * Wording that denies a feature rather than offering it. StayVista pages say
 * things like "No Wi-Fi is currently available" and "This is not a pet-friendly
 * property" in their house rules, and a listing that denies a feature must
 * never be named for it.
 */
const NEGATION = /\b(?:no|not|without|non|never|cannot|can't|isn't|aren't|lacks?|lacking|unavailable)\b/i;

/** Categories where proximity language changes the meaning of a match. */
const SETTING_CATEGORIES = new Set(['setting', 'view', 'beach', 'water']);

const REGION_NOISE = /^(?:india|maharashtra|karnataka|goa|kerala|tamil nadu|rajasthan|himachal pradesh|uttarakhand|punjab|gujarat|telangana|andhra pradesh|west bengal|madhya pradesh|state|district|union territory)$/i;

export function buildFacts(signals, overrides = {}) {
  const facts = {
    ota: signals.ota,
    url: signals.url,
    sources: signals.sources,
    name: signals.name || null,
    description: signals.description || null,
    bedrooms: signals.bedrooms || null,
    bathrooms: signals.bathrooms || null,
    guests: signals.guests || null,
    beds: signals.beds || null,
    rating: signals.rating || null,
    reviewCount: signals.reviewCount || null,
    amenityCount: (signals.amenityStrings || []).length,
  };

  facts.location = normalizeLocation(signals.location);
  facts.propertyType = exactPropertyType(signals.propertyTypeExact)
    || detectPropertyType(signals.typeCandidates || signals.typeHint || '');
  facts.brand = extractBrand(facts.name && facts.name.value, facts);
  facts.luxury = detectLuxury(signals.trustedText != null ? signals.trustedText : (signals.haystack || ''));
  facts.usps = matchUsps(signals);

  applyOverrides(facts, overrides);

  facts.guestFit = deriveGuestFit(facts);
  facts.coverage = computeCoverage(facts);
  return facts;
}

/* --------------------------------------------------------------- location */

function normalizeLocation(locationFact) {
  if (!locationFact || !locationFact.value) return null;
  const parts = String(locationFact.value).split(',').map((p) => clean(p)).filter(Boolean);
  const meaningful = parts.filter((p) => !REGION_NOISE.test(p));
  const chosen = (meaningful[0] || parts[0] || '').replace(/\s+\d{4,6}$/, '');
  if (!chosen) return null;
  return { ...locationFact, value: titleCase(chosen), full: locationFact.value };
}

/* ----------------------------------------------------------- property type */

/** The OTA named the type itself — map it to our wording, or keep theirs. */
function exactPropertyType(exact) {
  if (!exact || !exact.value) return null;
  const value = clean(exact.value);
  const known = PROPERTY_TYPES.find((entry) => entry.match.some((re) => re.test(value)))
    || PROPERTY_TYPES.find((entry) => entry.type.toLowerCase() === value.toLowerCase());
  if (known) return { value: known.type, short: known.short, source: exact.source, evidence: exact.evidence };
  const label = titleCase(value);
  if (label.split(/\s+/).length > 3 || label.length > 24) return null;
  return { value: label, short: label, source: exact.source, evidence: exact.evidence };
}

function detectPropertyType(candidates) {
  const list = Array.isArray(candidates)
    ? candidates
    : [{ text: String(candidates || ''), source: 'page-text' }];

  for (const candidate of list) {
    const text = candidate && candidate.text ? String(candidate.text) : '';
    if (!text) continue;

    // Every type that appears, with where it appears.
    const hits = [];
    for (const entry of PROPERTY_TYPES) {
      for (const re of entry.match) {
        const m = text.match(re);
        if (!m) continue;
        hits.push({ entry, index: m.index, length: m[0].length });
        break;
      }
    }
    if (!hits.length) continue;

    // Earliest wins, and a longer match beats a shorter one at the same spot,
    // so "3-star hotel" in the opening line beats "farmhouse" further down and
    // "farm house" beats the "house" inside it.
    hits.sort((a, b) => a.index - b.index || b.length - a.length);
    const chosen = hits.find((hit) => !inAreaContext(text, hit.index)) || null;
    if (!chosen) continue;

    return {
      value: chosen.entry.type,
      short: chosen.entry.short,
      source: candidate.source || 'page-text',
      evidence: quote(text, chosen.index, chosen.length),
    };
  }
  return null;
}

/**
 * True when the sentence around a match is talking about the area rather than
 * the property.
 */
function inAreaContext(text, index) {
  return AREA_MARKERS.test(sentenceAround(text, index));
}

/**
 * True when the words immediately before a match deny it: "No Wi-Fi is
 * available", "this is not a pet-friendly property", "without a pool".
 *
 * Only the run-up counts. A negation later in the sentence usually belongs to
 * something else entirely — "an expansive lawn ... and a sun deck you cannot
 * resist" is not a denial of the lawn.
 */
function isNegated(text, index) {
  const sentenceStart = Math.max(0, text.lastIndexOf('.', index) + 1);
  const runUp = text.slice(Math.max(sentenceStart, index - 50), index);
  return NEGATION.test(runUp);
}

/** The sentence containing a given offset. */
function sentenceAround(text, index) {
  const before = text.lastIndexOf('.', index);
  const start = Math.max(0, before < 0 ? index - 200 : before + 1);
  const after = text.indexOf('.', index);
  const end = after < 0 ? Math.min(text.length, index + 200) : after;
  return text.slice(start, end);
}

/* ------------------------------------------------------------------ brand */

const BRAND_STRIP = [
  /^\s*\d+\s*(?:bhk|bed\s?rooms?|bedroom|br)\b/i,
  /\b(?:entire|whole)\s+(?:villa|home|house|apartment|flat|place|bungalow)\b/i,
  /\bin\s+[A-Z][A-Za-z'’.\- ]+$/,
  /\bnear\s+[A-Z][A-Za-z'’.\- ]+$/,
  /\bwith\s+.*$/i,
  /\bfor\s+\d+\s+(?:guests?|people|pax)\b/i,
  /\b(?:hosted\s+by|by)\s+[A-Z][a-z]+$/,
];

/**
 * A listing name often already contains its brand: "Vista Dazzle - 6BHK Pool
 * Villa in Karjat" → "Vista Dazzle". Anything left that still looks like a
 * description rather than a name is discarded.
 */
function extractBrand(name, facts) {
  if (!name) return null;
  let candidate = String(name).split(/\s*[|•·]\s*|\s+[-–—]\s+|\s*,\s*/)[0];
  for (const re of BRAND_STRIP) candidate = candidate.replace(re, ' ');

  const typeWords = PROPERTY_TYPES.map((t) => t.type.replace(/\s+/g, '\\s?')).join('|');
  candidate = candidate
    .replace(new RegExp(`\\b(?:${typeWords})s?\\b`, 'gi'), ' ')
    .replace(/\b(?:pool|private|luxury|luxurious|premium|stay|stays|the|a|an)\b/gi, ' ')
    .replace(/[,:;]/g, ' ');
  if (facts.location && facts.location.value) {
    candidate = candidate.replace(new RegExp(`\\b${escapeRe(facts.location.value)}\\b`, 'gi'), ' ');
  }
  candidate = clean(candidate).replace(/^[-–—\s]+|[-–—\s]+$/g, '');

  const words = candidate.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (/\d/.test(candidate)) return null;
  if (candidate.length < 3 || candidate.length > 28) return null;
  // "StayVista" is how the brand spells itself — do not flatten it to "Stayvista".
  const value = /[a-z][A-Z]/.test(candidate) ? candidate : titleCase(candidate);
  return { value, source: 'page-text', evidence: `From the listing name "${name}"` };
}

/* ----------------------------------------------------------------- luxury */

function detectLuxury(haystack) {
  for (const re of LUXURY_EVIDENCE) {
    const m = haystack.match(re);
    if (m) return { value: true, source: 'page-text', evidence: quote(haystack, m.index, m[0].length) };
  }
  return { value: false, source: null, evidence: null };
}

/* ------------------------------------------------------------------- USPs */

/**
 * Matches the catalog against two zones.
 *
 * The trusted zone is what the listing says about itself (title, description,
 * amenity list, and anything the user pasted or added). A feature found there
 * is `confirmed` and may be used to name the property.
 *
 * The page zone is the rest of the page. OTAs fill it with other properties,
 * filter labels and amenity glossaries, so a feature found only there is
 * reported as unconfirmed and never used in a name — a nearby villa's river
 * view must not become this property's river view.
 */
export function matchUsps(signals = {}) {
  const zones = (signals.zones && signals.zones.length)
    ? signals.zones
    : [{ kind: 'page-text', text: signals.trustedText || signals.haystack || '' }];
  const page = signals.pageText || '';
  const found = [];

  const denied = deniedSet(signals);

  for (const usp of USP_CATALOG) {
    // The page listed this feature as unavailable: it can never be claimed,
    // whatever the rest of the copy says.
    if (isDenied(usp, denied)) {
      found.push(buildUsp(usp, {
        source: 'page-text',
        evidence: 'Listed as unavailable on the property page',
        mentions: 0,
        confirmed: false,
        denied: true,
      }));
      continue;
    }

    let matched = false;
    for (const zone of zones) {
      const hit = firstMatch(usp, zone.text);
      if (!hit) continue;
      // "Ten minutes from the beach" is not a beachfront property, and
      // "no Wi-Fi is available" is not an amenity.
      const sentence = sentenceAround(zone.text, hit.index);
      const aboutTheArea = (SETTING_CATEGORIES.has(usp.category) && AREA_MARKERS.test(sentence))
        || isNegated(zone.text, hit.index);
      found.push(buildUsp(usp, {
        source: aboutTheArea ? 'page-text' : zone.kind,
        evidence: quote(zone.text, hit.index, hit.length),
        mentions: countMentions(zone.text, hit.re),
        confirmed: !aboutTheArea,
        aboutTheArea,
      }));
      matched = true;
      break;
    }
    if (matched) continue;

    const pageHit = firstMatch(usp, page);
    if (pageHit) {
      found.push(buildUsp(usp, {
        source: 'page-text',
        evidence: quote(page, pageHit.index, pageHit.length),
        mentions: countMentions(page, pageHit.re),
        confirmed: false,
      }));
    }
  }
  return dedupeByFeature(found);
}

/** Feature names the page listed as unavailable, lower-cased. */
function deniedSet(signals) {
  return new Set((signals.deniedTerms || []).map((term) => String(term).toLowerCase().trim()).filter(Boolean));
}

function isDenied(usp, denied) {
  if (!denied.size) return false;
  for (const term of denied) {
    if (!term) continue;
    if (usp.match.some((re) => re.test(term))) return true;
    if (usp.label.toLowerCase() === term) return true;
  }
  return false;
}

function firstMatch(usp, text) {
  if (!text) return null;
  for (const re of usp.match) {
    const m = text.match(re);
    if (m) return { index: m.index, length: m[0].length, re };
  }
  return null;
}

function buildUsp(usp, extra) {
  return {
    id: usp.id,
    label: usp.label,
    short: usp.short,
    category: usp.category,
    feature: usp.feature || usp.id,
    weight: usp.weight,
    titleWorthy: usp.titleWorthy !== false,
    tags: usp.tags || [],
    needsExplicit: Boolean(usp.needsExplicit),
    ...extra,
  };
}

/**
 * Only the strongest wording of the *same* feature survives, so a listing that
 * says "private swimming pool" yields "Private Pool" and not also "Pool".
 * Distinct features in one category (a pool table and indoor games) both stay —
 * they are separate facts about the property. Keeping only one per *title* is
 * a naming decision, made later.
 */
function dedupeByFeature(list) {
  const best = new Map();
  for (const usp of list) {
    const current = best.get(usp.feature);
    if (!current || beats(usp, current)) best.set(usp.feature, usp);
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * A confirmed feature always beats an unconfirmed one, whatever the wording is
 * worth. Otherwise a neighbouring listing's "infinity pool" would displace this
 * property's own "private pool" and then be filtered out for being unconfirmed,
 * losing the pool altogether.
 */
function beats(candidate, current) {
  const candidateConfirmed = candidate.confirmed !== false;
  const currentConfirmed = current.confirmed !== false;
  if (candidateConfirmed !== currentConfirmed) return candidateConfirmed;
  return candidate.weight > current.weight;
}

function countMentions(haystack, re) {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const matches = haystack.match(global);
  return matches ? matches.length : 1;
}

/* -------------------------------------------------------------- overrides */

function applyOverrides(facts, overrides) {
  const num = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  if (nonEmpty(overrides.name)) facts.name = { value: clean(overrides.name), source: 'manual', evidence: 'Entered by you' };
  if (nonEmpty(overrides.brand)) facts.brand = { value: clean(overrides.brand), source: 'manual', evidence: 'Entered by you' };
  if (nonEmpty(overrides.location)) {
    facts.location = { value: titleCase(clean(overrides.location)), source: 'manual', evidence: 'Entered by you' };
  }
  if (nonEmpty(overrides.propertyType)) {
    const typed = clean(overrides.propertyType);
    const known = PROPERTY_TYPES.find((t) => t.type.toLowerCase() === typed.toLowerCase());
    facts.propertyType = { value: known ? known.type : titleCase(typed), short: known ? known.short : titleCase(typed), source: 'manual', evidence: 'Entered by you' };
  }
  for (const key of ['bedrooms', 'bathrooms', 'guests', 'beds']) {
    if (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== '') {
      const n = num(overrides[key]);
      facts[key] = n ? { value: n, source: 'manual', evidence: 'Entered by you' } : null;
    }
  }

  const removed = new Set(
    (overrides.removeUsps || []).map((r) => String(r).toLowerCase().trim()).filter(Boolean),
  );
  if (removed.size) {
    facts.removedUsps = facts.usps
      .filter((u) => removed.has(u.id) || removed.has(u.label.toLowerCase()))
      .map((u) => u.label);
    facts.usps = facts.usps.filter((u) => !removed.has(u.id) && !removed.has(u.label.toLowerCase()));
  }

  for (const raw of overrides.addUsps || []) {
    const text = clean(raw);
    if (!text || text.length > 40) continue;

    // "Panoramic mountain view" matches both mountain_view and panoramic_view;
    // adding every match means the stronger, more specific wording is available.
    const matches = USP_CATALOG.filter((u) => u.match.some((re) => re.test(text)));
    let added = 0;
    for (const known of matches) {
      const feature = known.feature || known.id;
      const existing = facts.usps.find((u) => (u.feature || u.id) === feature);
      if (existing && existing.confirmed !== false) continue;
      // The feature was only seen elsewhere on the page; confirming it by hand
      // promotes it to a fact this property may be named for.
      if (existing) facts.usps = facts.usps.filter((u) => u !== existing);
      facts.usps.push({
        id: known.id, label: known.label, short: known.short, category: known.category,
        feature, weight: known.weight, titleWorthy: known.titleWorthy !== false, tags: known.tags || [],
        source: 'manual-added', evidence: `You added "${text}"`, mentions: 1, confirmed: true, needsExplicit: Boolean(known.needsExplicit),
      });
      added += 1;
    }
    if (added) continue;

    // Nothing in the catalog covers it — keep the user's own wording.
    const label = titleCase(text);
    if (matches.length || facts.usps.some((u) => u.label.toLowerCase() === label.toLowerCase())) continue;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    facts.usps.push({
      id: `manual_${slug}`, label, short: label, category: `manual_${slug}`, feature: `manual_${slug}`,
      weight: 74, titleWorthy: true, tags: [], source: 'manual-added', evidence: `You added "${text}"`,
      mentions: 1, confirmed: true, needsExplicit: false, manual: true,
    });
  }
  facts.usps.sort((a, b) => b.weight - a.weight);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/* ------------------------------------------------------------- guest fit */

function deriveGuestFit(facts) {
  const bedrooms = facts.bedrooms ? facts.bedrooms.value : null;
  const guests = facts.guests ? facts.guests.value : null;
  const has = (id) => facts.usps.some((u) => u.id === id);

  const fits = [];
  if ((bedrooms && bedrooms >= 4) || (guests && guests >= 10)) fits.push('group');
  if (has('family_friendly') || has('play_area') || has('kids_pool') || (bedrooms && bedrooms >= 3)) fits.push('family');
  if ((bedrooms && bedrooms <= 1) || (guests && guests <= 2)) fits.push('couple');
  if (has('work_friendly') || has('wifi')) fits.push('work');
  if (!fits.length) fits.push('general');
  return fits;
}

/* -------------------------------------------------------------- coverage */

const COVERAGE_FIELDS = [
  { key: 'name', label: 'Property name', weight: 20 },
  { key: 'location', label: 'Location', weight: 20 },
  { key: 'bedrooms', label: 'Bedrooms', weight: 18 },
  { key: 'propertyType', label: 'Property type', weight: 14 },
  { key: 'guests', label: 'Guest capacity', weight: 8 },
  { key: 'description', label: 'Description', weight: 10 },
];

function computeCoverage(facts) {
  const missing = [];
  let score = 0;
  for (const field of COVERAGE_FIELDS) {
    if (facts[field.key]) score += field.weight;
    else missing.push(field.label);
  }
  const titleWorthy = facts.usps.filter((u) => u.titleWorthy && u.confirmed !== false && u.weight >= 50);
  if (titleWorthy.length >= 1) score += 5;
  if (titleWorthy.length >= 3) score += 5;
  if (!titleWorthy.length) missing.push('Any strong USP');

  return {
    score: Math.min(100, score),
    missing,
    partial: missing.length > 0,
    uspCount: facts.usps.length,
    titleWorthyCount: titleWorthy.length,
  };
}

/* ---------------------------------------------------------------- helpers */

const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'by', 'a', 'an', 'for', 'to']);

export function titleCase(text) {
  return String(text)
    .toLowerCase()
    .replace(/\b([a-z])([a-z'’]*)/g, (match, a, b, offset) => (
      offset > 0 && SMALL_WORDS.has(match) ? match : a.toUpperCase() + b
    ))
    .replace(/\bBhk\b/g, 'BHK')
    .replace(/\bBbq\b/g, 'BBQ')
    .replace(/\bAc\b/g, 'AC')
    .replace(/\bTv\b/g, 'TV')
    .replace(/\bWi-?fi\b/gi, 'Wi-Fi');
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quote(haystack, index, length) {
  if (index == null) return null;
  const start = Math.max(0, index - 50);
  const end = Math.min(haystack.length, index + length + 60);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < haystack.length ? '...' : '';
  return `"${prefix}${clean(haystack.slice(start, end))}${suffix}"`;
}
