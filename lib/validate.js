/**
 * validate.js — the accuracy gate.
 *
 * Two independent checks run on every candidate name, whoever wrote it (the
 * template engine or Claude):
 *
 *  1. Vocabulary — every meaningful word must trace back to a verified fact.
 *     A name containing "Private" when the listing only said "Swimming pool"
 *     is rejected, not softened.
 *  2. OTA guidelines — no phone numbers, URLs, prices, urgency, shouting,
 *     emoji or unsupported superlatives, and never over the character limit.
 */

import { GATED_WORDS, TITLE_VIOLATIONS, SHORTENINGS, USP_CATALOG } from './knowledge.js';
import { EXPERIENCE_PHRASES } from './names.js';

const SHORTENING_WORDS = SHORTENINGS.flatMap(([, replacement]) => words(replacement));

export function buildVocabulary(facts, ranking) {
  const allowed = new Set();
  const gatedAllowed = new Set();

  const add = (text) => {
    for (const word of words(text)) allowed.add(word);
  };

  // The property's own name is verified, so its words are usable even when one
  // of them is otherwise a gated claim word ("The Infinity Heaven", "Private
  // Retreat"). The phrase check below still stops "Infinity Pool".
  add(facts.brand && facts.brand.value);
  add(facts.name && facts.name.value);
  for (const word of words(`${facts.brand ? facts.brand.value : ''} ${facts.name ? facts.name.value : ''}`)) {
    if (GATED_WORDS.includes(word)) gatedAllowed.add(word);
  }

  add(facts.location && facts.location.value);
  add(facts.propertyType && facts.propertyType.value);
  add(facts.propertyType && facts.propertyType.short);
  for (const word of SHORTENING_WORDS) allowed.add(word);

  // Unconfirmed features (seen elsewhere on the page) deliberately contribute
  // nothing here, so no name can claim them.
  for (const usp of (facts.usps || []).filter((u) => u.confirmed !== false)) {
    add(usp.label);
    add(usp.short);
    if (EXPERIENCE_PHRASES[usp.id]) add(EXPERIENCE_PHRASES[usp.id]);
    for (const word of words(`${usp.label} ${usp.short || ''}`)) {
      if (GATED_WORDS.includes(word)) gatedAllowed.add(word);
    }
  }

  if (facts.luxury && facts.luxury.value) {
    allowed.add('luxury');
    allowed.add('luxe');
    gatedAllowed.add('luxury');
    gatedAllowed.add('luxe');
  }

  const fits = new Set(facts.guestFit || []);
  if (fits.has('family')) allowed.add('family');
  if (fits.has('group')) allowed.add('group');

  const numbers = new Set();
  for (const key of ['bedrooms', 'bathrooms', 'guests', 'beds']) {
    if (facts[key]) numbers.add(String(facts[key].value));
  }

  // A size claim must match the count for *that* unit: "8BHK" is wrong even on
  // a 6-bedroom property that happens to have 8 beds.
  const sizeNumbers = {
    rooms: facts.bedrooms ? String(facts.bedrooms.value) : null,
    beds: facts.beds ? String(facts.beds.value) : null,
    baths: facts.bathrooms ? String(facts.bathrooms.value) : null,
  };

  return { allowed, gatedAllowed, numbers, sizeNumbers, forbiddenPhrases: forbiddenPhrases(facts) };
}

/**
 * Wordings the name must not use, phrase by phrase.
 *
 * Word-level checking is not enough on its own. A villa named "The Infinity
 * Heaven" legitimately uses "Infinity", and a confirmed "Private Pool" makes
 * "pool" legitimate — but "Infinity Pool" is a stronger claim than the page
 * supports, and it is built entirely from allowed words. So each catalog
 * wording that would *upgrade* what the page confirms is forbidden outright.
 */
function forbiddenPhrases(facts) {
  const confirmed = (facts.usps || []).filter((u) => u.confirmed !== false);
  const byFeature = new Map();
  for (const usp of confirmed) byFeature.set(usp.feature || usp.id, usp);

  const phrases = [];
  for (const entry of USP_CATALOG) {
    const feature = entry.feature || entry.id;
    const held = byFeature.get(feature);

    if (held) {
      // Same thing, stronger wording than the page gives us.
      if (entry.id !== held.id && entry.needsExplicit && entry.weight > held.weight) {
        phrases.push(entry.label);
      }
      continue;
    }
    // A feature the page does not mention at all: block its multi-word wording,
    // since single words are already covered by the vocabulary check.
    if (entry.needsExplicit && entry.label.includes(' ')) phrases.push(entry.label);
  }
  return phrases;
}

/**
 * @returns {{ok: boolean, violations: Array, unsupported: string[]}}
 */
export function validateName(name, facts, ranking, limit, vocabulary) {
  const vocab = vocabulary || buildVocabulary(facts, ranking);
  const violations = [];

  for (const rule of TITLE_VIOLATIONS) {
    if (rule.test(name)) {
      violations.push({ id: rule.id, severity: rule.severity, message: rule.message });
    }
  }

  if (name.length > limit) {
    violations.push({
      id: 'length',
      severity: 'fatal',
      message: `${name.length} characters exceeds the ${limit}-character limit`,
    });
  }
  if (name.length < 8) {
    violations.push({ id: 'too-short', severity: 'fatal', message: 'Too short to describe the property' });
  }
  if ((name.match(/[|•]/g) || []).length > 3) {
    violations.push({ id: 'segments', severity: 'major', message: 'Too many separated segments to scan quickly' });
  }

  for (const phrase of vocab.forbiddenPhrases || []) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(name)) {
      violations.push({
        id: 'unsupported-phrase',
        severity: 'fatal',
        message: `"${phrase}" claims more than the page confirms`,
      });
    }
  }

  const unsupported = [];
  for (const word of words(name)) {
    if (NEUTRAL.has(word)) continue;
    if (vocab.numbers.has(word) || /^\d+$/.test(word)) continue;
    if (isSizeToken(word, vocab)) continue;
    if (GATED_WORDS.includes(word)) {
      if (!vocab.gatedAllowed.has(word)) unsupported.push(word);
      continue;
    }
    if (!vocab.allowed.has(word)) unsupported.push(word);
  }

  if (unsupported.length) {
    violations.push({
      id: 'unsupported',
      severity: 'fatal',
      message: `Not supported by the listing: ${unique(unsupported).join(', ')}`,
    });
  }

  return {
    ok: !violations.some((v) => v.severity === 'fatal'),
    violations,
    unsupported: unique(unsupported),
  };
}

/** "6bhk" / "6br" tokens are size claims and must match the verified count. */
function isSizeToken(word, vocab) {
  const m = word.match(/^(\d+(?:\.\d+)?)(bhk|br|bedroom|bedrooms|bed|beds|bath|baths|bathroom|bathrooms|guests?|pax)$/);
  if (!m) return false;
  const [, count, unit] = m;
  const sizes = vocab.sizeNumbers || {};
  if (/^(?:bhk|br|bedroom|bedrooms)$/.test(unit)) return sizes.rooms === count;
  if (/^(?:bed|beds)$/.test(unit)) return sizes.beds === count;
  if (/^(?:bath|baths|bathroom|bathrooms)$/.test(unit)) return sizes.baths === count;
  return vocab.numbers.has(count);
}

const NEUTRAL = new Set([
  'and', 'with', 'at', 'in', 'on', 'for', 'the', 'a', 'an', 'of', 'by', 'near',
  'stay', 'stays', 'retreat', 'escape', 'getaway', 'hideaway', 'haven', 'home',
  'nest', 'abode', 'bhk', 'br', 'bed', 'beds', 'bedroom', 'bedrooms', 'guest',
  'guests', 'pax', 'sleeps', 'bath', 'baths', 'bathroom', 'bathrooms', 'cosy',
  'cozy', 'stayvista', 'vista',
]);

function words(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[•·|,:;()"'’]/g, ' ')
    .replace(/[^a-z0-9&\-\s]/g, ' ')
    .split(/[\s\-&]+/)
    .map((w) => w.trim())
    .filter((w) => w && w !== '&');
}

function unique(list) {
  return [...new Set(list)];
}
