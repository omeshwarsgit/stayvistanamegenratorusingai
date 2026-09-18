/**
 * names.js — build title candidates from verified facts only.
 *
 * A candidate is a list of segments joined with " • ", each with a priority.
 * When a name is too long the shortener first swaps in safe short forms, then
 * drops the lowest-priority segment — so the strongest USP, the size and the
 * location are the last things to go, and nothing is ever truncated mid-word.
 */

import { SHORTENINGS } from './knowledge.js';
import { comboLabel } from './usp.js';

/**
 * OTA titles read as blocks separated by a pipe, with the town appended after a
 * comma — the shape OTA listings use, and the shape the brief asks for:
 *   4BHK Villa with Pvt Pool | Bel Air Mansion, Lonavala
 */
export const SEPARATOR = ' | ';

/** The structures a title can take, shown to the user per option. */
export const STRUCTURES = {
  sizeUspTypeLocation: 'BHK + USP + Type, Location',
  nameSizeUspLocation: 'Name + BHK + USP, Location',
  uspSizeNameLocation: 'USP + BHK + Name, Location',
  sizeNameUsp: 'BHK + Name + USP (no location)',
  sizeTypeUsps: 'BHK + Type + two USPs, Location',
  experience: 'Experience + USP, Location',
  locationFirst: 'Location + Type + USP',
};

export const STYLES = {
  usp: 'USP Focused',
  experience: 'Experience Focused',
  location: 'Location Focused',
  luxury: 'Luxury Focused',
  group: 'Group/Family Focused',
  brand: 'Existing Name + USP',
};

/** Only "-side"/"-front" facts may become "-side" words; a view is not a location. */
export const EXPERIENCE_PHRASES = {
  hilltop: 'Hilltop Retreat',
  beachfront: 'Beach Escape',
  private_beach: 'Beach Escape',
  lakefront: 'Lakeside Retreat',
  riverside: 'Riverside Retreat',
  waterfall: 'Waterfall Retreat',
  vineyard: 'Vineyard Retreat',
  plantation: 'Plantation Retreat',
  farm: 'Farm Retreat',
  treehouse: 'Treehouse Escape',
  secluded: 'Secluded Retreat',
  heritage: 'Heritage Stay',
  mountain_view: 'Mountain Retreat',
  valley_view: 'Valley Retreat',
  forest_view: 'Forest Retreat',
  hill_view: 'Hill Retreat',
  sea_view: 'Sea View Retreat',
  lake_view: 'Lake View Retreat',
  river_view: 'River View Retreat',
  fireplace: 'Cosy Retreat',
  spa: 'Spa Retreat',
  jacuzzi: 'Jacuzzi Retreat',
};

/** The slot set the templates and the per-OTA writer both work from. */
export function nameSlots(facts, ranking) {
  return buildSlots(facts, ranking);
}

export function generateNames(facts, ranking, options = {}) {
  const limit = clampLimit(options.maxChars);
  const slots = buildSlots(facts, ranking);
  const candidates = [];

  for (const build of TEMPLATES) {
    const segments = build(slots);
    if (!segments) continue;
    const kept = segments.filter((s) => s && s.text);
    if (kept.length < 2) continue;
    candidates.push({ style: build.style, structure: build.structure, segments: kept });
  }

  const seen = new Set();
  const names = [];
  for (const candidate of candidates) {
    const fitted = fitToLimit(candidate.segments, limit, slots);
    if (!fitted) continue;
    const key = normalizeKey(fitted.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push({
      name: fitted.name,
      style: candidate.style,
      styleLabel: STYLES[candidate.style] || candidate.style,
      structure: candidate.structure || null,
      length: fitted.name.length,
      limit,
      shortened: fitted.shortened,
      dropped: fitted.dropped,
      uspIds: usedUspIds(fitted.name, slots),
      origin: 'engine',
    });
  }
  return names;
}

/* ------------------------------------------------------------------ slots */

function buildSlots(facts, ranking) {
  const titleUsps = ranking.titleUsps || [];

  // A title may carry at most one USP per category: "Pool Table & Indoor Games"
  // says one thing twice, while "Pool & Games" covers two.
  const distinct = [];
  const usedCategories = new Set();
  for (const usp of titleUsps) {
    if (usedCategories.has(usp.category)) continue;
    usedCategories.add(usp.category);
    distinct.push(usp);
  }
  const usp1 = distinct[0] || null;
  const usp2 = distinct[1] || null;
  const usp3 = distinct[2] || null;

  const bedrooms = facts.bedrooms ? facts.bedrooms.value : null;

  // A guest count read off the page body is often a function-room or events
  // capacity ("accommodates up to 30"), so it may inform the analysis but not a
  // title. Structured sources and the user's own corrections are trusted.
  const guestsTrusted = facts.guests && facts.guests.source !== 'page-text';
  const guests = guestsTrusted ? facts.guests.value : null;
  const type = facts.propertyType ? facts.propertyType.value : null;
  const typeShort = facts.propertyType ? facts.propertyType.short || facts.propertyType.value : null;

  // A setting or view USP can sit in front of the type ("Hilltop Villa").
  const modifier = distinct.find((u) => ['setting', 'view', 'beach', 'water'].includes(u.category)
    && u.strength >= 70
    && u.label.split(/\s+/).length <= 2) || null;

  return {
    facts,
    titleUsps,
    distinct,
    usp1,
    usp2,
    usp3,
    modifier,
    size: bedrooms ? `${bedrooms}BHK` : null,
    sizeWords: bedrooms ? `${bedrooms}-Bedroom` : null,
    guests,
    sleeps: guests ? `Sleeps ${guests}` : null,
    forGuests: guests ? `for ${guests}` : null,
    type,
    typeShort,
    brand: facts.brand ? facts.brand.value : null,
    loc: facts.location ? facts.location.value : null,
    luxury: Boolean(facts.luxury && facts.luxury.value),
    fits: new Set(facts.guestFit || []),
    combo: comboLabel(distinct.filter((u) => u.strength >= 50)),
    experience: pickExperience(distinct),
  };
}

function pickExperience(titleUsps) {
  for (const usp of titleUsps) {
    if (EXPERIENCE_PHRASES[usp.id]) return { text: EXPERIENCE_PHRASES[usp.id], usp };
  }
  return null;
}

/* -------------------------------------------------------------- templates */

const seg = (text, priority) => (text ? { text: String(text).trim(), priority } : null);
const loc = (text, priority) => (text ? { text: String(text).trim(), priority, role: 'location' } : null);

/**
 * Priorities: 10 = never drop, 9 = strongest USP, 8 = location,
 * 6-7 = secondary USP or brand, 4-5 = nice-to-have.
 */
const TEMPLATES = [];

function template(style, fn, structure) {
  fn.style = style;
  fn.structure = structure || null;
  TEMPLATES.push(fn);
}

/* ---- The structures the brief asks for --------------------------------- */

// [BHK] + [USP] + [Type], Location  →  4BHK Villa with Pvt Pool, Lonavala
template('usp', (s) => {
  if (!s.usp1 || !s.type) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  return [seg(`${head} with ${s.usp1.short || s.usp1.label}`, 10), loc(s.loc, 8)];
}, STRUCTURES.sizeUspTypeLocation);

// [Name] + [BHK] + [USP], Location  →  Bel Air Mansion | 4BHK Pvt Pool Villa, Lonavala
template('brand', (s) => {
  if (!s.brand || !s.usp1 || !s.type) return null;
  return [seg(s.brand, 10), seg([s.size, s.usp1.short || s.usp1.label, s.type].filter(Boolean).join(' '), 9), loc(s.loc, 8)];
}, STRUCTURES.nameSizeUspLocation);

// [USP] + [BHK] + [Name], Location  →  Pvt Pool 4BHK Villa | Bel Air Mansion, Lonavala
template('usp', (s) => {
  if (!s.usp1 || !s.brand) return null;
  const head = [s.usp1.short || s.usp1.label, s.size, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), seg(s.brand, 9), loc(s.loc, 7)];
}, STRUCTURES.uspSizeNameLocation);

// [BHK] + [Name] + [strongest USP], no location
template('brand', (s) => {
  if (!s.brand || !s.usp1) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(`${head} ${s.brand}`.trim(), 10), seg(s.usp1.label, 9)];
}, STRUCTURES.sizeNameUsp);

// [BHK] + [Type] + two USPs, Location  →  4BHK Villa | Pvt Pool & Lawn, Lonavala
template('usp', (s) => {
  if (!s.usp1 || !s.usp2) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(head, 10), seg(`${s.usp1.short || s.usp1.label} & ${s.usp2.short || s.usp2.label}`, 9), loc(s.loc, 8)];
}, STRUCTURES.sizeTypeUsps);

// ---- USP focused -----------------------------------------------------------
template('usp', (s) => {
  if (!s.usp1) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(head, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

template('usp', (s) => {
  if (!s.usp1 || !s.modifier || s.modifier === s.usp1 || !s.type) return null;
  const head = [s.size, s.modifier.label, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

template('usp', (s) => {
  if (!s.usp1 || !s.usp2) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(head, 10), seg(`${s.usp1.short || s.usp1.label} & ${s.usp2.short || s.usp2.label}`, 9), loc(s.loc, 8)];
});

template('usp', (s) => {
  if (!s.combo) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(head, 10), seg(s.combo, 9), loc(s.loc, 8)];
});

template('usp', (s) => {
  if (!s.usp1 || !s.type || !s.loc) return null;
  return [seg(`${[s.size, s.usp1.label, s.type].filter(Boolean).join(' ')} in ${s.loc}`, 10)];
});

// ---- Experience focused ----------------------------------------------------
template('experience', (s) => {
  if (!s.experience) return null;
  const head = [s.size, s.experience.text].filter(Boolean).join(' ');
  const other = s.distinct.find((u) => u.category !== s.experience.usp.category);
  return [seg(head, 10), seg(other && other.label, 9), loc(s.loc, 8)];
});

template('experience', (s) => {
  if (!s.experience || !s.combo) return null;
  return [seg([s.size, s.experience.text].filter(Boolean).join(' '), 10), seg(s.combo, 9), loc(s.loc, 8)];
});

// ---- Location focused ------------------------------------------------------
template('location', (s) => {
  if (!s.loc || !s.type) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  return [seg(`${head} in ${s.loc}`, 10), seg(s.usp1 && s.usp1.label, 9), seg(s.usp2 && s.usp2.short, 5)];
});

template('location', (s) => {
  if (!s.loc || !s.usp1) return null;
  const head = [s.loc, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), seg(s.usp1.label, 9), seg(s.usp2 && (s.usp2.short || s.usp2.label), 6)];
});

// ---- Luxury focused (only with listing evidence) ---------------------------
template('luxury', (s) => {
  if (!s.luxury || !s.usp1) return null;
  const head = ['Luxury', s.size, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

template('luxury', (s) => {
  if (!s.luxury || !s.brand || !s.usp1) return null;
  return [seg(s.brand, 10), seg(['Luxury', s.size, s.type].filter(Boolean).join(' '), 9), seg(s.usp1.short || s.usp1.label, 7), loc(s.loc, 8)];
});

// ---- Group / family focused ------------------------------------------------
template('group', (s) => {
  if (!s.fits.has('group') || !s.guests || !s.usp1) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(`${head} ${s.forGuests}`, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

template('group', (s) => {
  if (!(s.fits.has('group') || s.fits.has('family'))) return null;
  const groupUsps = s.distinct.filter((u) => u.tags.includes('group') || u.tags.includes('family'));
  if (groupUsps.length < 2) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  if (!head) return null;
  return [seg(head, 10), seg(`${groupUsps[0].short || groupUsps[0].label} & ${groupUsps[1].short || groupUsps[1].label}`, 9), loc(s.loc, 8)];
});

template('group', (s) => {
  if (!s.fits.has('family') || !s.usp1) return null;
  const head = [s.size, 'Family', s.type].filter(Boolean).join(' ');
  if (!s.type) return null;
  return [seg(head, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

// ---- Existing name + USP ---------------------------------------------------
template('brand', (s) => {
  if (!s.brand || !s.usp1) return null;
  const mid = [s.size, s.usp1.label, s.type].filter(Boolean).join(' ');
  return [seg(s.brand, 10), seg(mid, 9), loc(s.loc, 8)];
});

template('brand', (s) => {
  if (!s.brand || !s.usp1) return null;
  const head = [s.brand, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), seg(s.usp1.label, 9), loc(s.loc, 8)];
});

template('brand', (s) => {
  if (!s.brand || !s.combo) return null;
  return [seg(s.brand, 10), seg([s.size, s.type].filter(Boolean).join(' '), 8), seg(s.combo, 9), loc(s.loc, 7)];
});

template('brand', (s) => {
  if (!s.brand || !s.usp1 || !s.type) return null;
  return [seg(s.brand, 10), seg(`${s.usp1.label} ${s.type}`, 9), loc(s.loc, 8)];
});

// ---- No confirmed USP: still offer accurate, if plain, names ---------------
// These score low on differentiation, which is the honest outcome — but a
// listing with nothing confirmed should not leave the user with nothing.
template('usp', (s) => {
  if (s.usp1 || !s.type || !s.loc) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  return [seg(head, 10), loc(s.loc, 9)];
});

template('brand', (s) => {
  if (s.usp1 || !s.brand || !s.loc) return null;
  return [seg(s.brand, 10), seg([s.size, s.type].filter(Boolean).join(' '), 8), loc(s.loc, 9)];
});

template('group', (s) => {
  if (s.usp1 || !s.guests || !s.type) return null;
  const head = [s.size, s.type].filter(Boolean).join(' ');
  return [seg(`${head} ${s.forGuests}`, 10), loc(s.loc, 9)];
});

/* -------------------------------------------------------------- assembling */

export function joinSegments(segments) {
  const blocks = segments.filter((s) => s && s.text && s.role !== 'location');
  const location = segments.find((s) => s && s.text && s.role === 'location');

  const joined = dedupeWords(
    blocks.map((s) => s.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(SEPARATOR),
  )
    .replace(/\s*\|\s*/g, SEPARATOR)
    .replace(/(?:\s*\|\s*)+$/, '')
    .replace(/^(?:\s*\|\s*)+/, '')
    .trim();

  if (!location) return joined;
  const town = location.text.trim();
  // Do not repeat a town the blocks already name ("... in Lonavala, Lonavala").
  if (!town || new RegExp(`\\b${escapeForRegExp(town)}\\b`, 'i').test(joined)) return joined;
  return joined ? `${joined}, ${town}` : town;
}

function escapeForRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Vista Villa | Villa" → "Vista Villa". */
function dedupeWords(name) {
  const parts = name.split(SEPARATOR);
  const seenWords = new Set();
  const kept = [];
  for (const part of parts) {
    const words = part.split(/\s+/).filter(Boolean);
    const filtered = words.filter((w) => {
      const key = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key || key.length < 3) return true;
      if (seenWords.has(key)) return false;
      seenWords.add(key);
      return true;
    });
    const rebuilt = trimConnectors(filtered.join(' '));
    if (rebuilt) kept.push(rebuilt);
  }
  return kept.join(SEPARATOR);
}

/** Dropping a duplicate word can strand a connector: "Pool &" → "Pool". */
function trimConnectors(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:&|and|with|in|at|for|of)\s+/i, '')
    .replace(/\s+(?:&|and|with|in|at|for|of)\s*$/i, '')
    .trim();
}

/**
 * Bring a candidate under the character limit without losing the strongest
 * USP. Returns null only if even the highest-priority segments cannot fit.
 */
export function fitToLimit(segments, limit, slots = {}) {
  let working = segments.map((s) => ({ ...s }));
  let name = joinSegments(working);
  const notes = { shortened: [], dropped: [] };
  if (name.length <= limit) return { name, ...notes };

  // 1. Safe abbreviations.
  for (const [pattern, replacement] of SHORTENINGS) {
    if (name.length <= limit) break;
    const next = working.map((s) => ({ ...s, text: s.text.replace(pattern, replacement) }));
    const candidate = joinSegments(next);
    if (candidate !== name) {
      working = next;
      name = candidate;
      notes.shortened.push(`${String(pattern.source).replace(/\\b/g, '')} → ${replacement}`);
    }
  }

  // 2. Short forms of USP labels ("Mountain View" → "Mtn View").
  if (name.length > limit) {
    const shortMap = new Map();
    for (const usp of slots.titleUsps || []) {
      if (usp.short && usp.short !== usp.label) shortMap.set(usp.label, usp.short);
    }
    for (const [label, short] of shortMap) {
      if (name.length <= limit) break;
      const next = working.map((s) => ({ ...s, text: s.text.split(label).join(short) }));
      const candidate = joinSegments(next);
      if (candidate !== name) {
        working = next;
        name = candidate;
        notes.shortened.push(`${label} → ${short}`);
      }
    }
  }

  // 3. Drop the least important segment, repeatedly.
  while (name.length > limit && working.length > 1) {
    let weakestIndex = 0;
    for (let i = 1; i < working.length; i += 1) {
      if (working[i].priority < working[weakestIndex].priority) weakestIndex = i;
    }
    notes.dropped.push(working[weakestIndex].text);
    working.splice(weakestIndex, 1);
    name = joinSegments(working);
  }

  if (name.length > limit) return null;
  return { name, ...notes };
}

export function usedUspIds(name, slots) {
  const lower = name.toLowerCase();
  const ids = [];
  for (const usp of slots.titleUsps || []) {
    const label = (usp.label || '').toLowerCase();
    const short = (usp.short || '').toLowerCase();
    if ((label && lower.includes(label)) || (short && lower.includes(short))) ids.push(usp.id);
  }
  if (slots.experience && lower.includes(slots.experience.text.toLowerCase()) && !ids.includes(slots.experience.usp.id)) {
    ids.push(slots.experience.usp.id);
  }
  return ids;
}

export function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(120, Math.max(20, Math.round(n)));
}

function normalizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
