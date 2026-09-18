/**
 * score.js — score a candidate title out of 100 on the eight criteria in the
 * brief, and explain the score in the words a content specialist would use.
 *
 * The weights encode the product's opinion: a title earns most of its score by
 * carrying a real differentiator that the right guest cares about, and only a
 * little by being tidy.
 */

const WEIGHTS = {
  uspStrength: 22,
  guestAppeal: 16,
  clarity: 14,
  relevance: 14,
  differentiation: 12,
  readability: 8,
  charEfficiency: 8,
  otaSuitability: 6,
};

const CRITERION_LABELS = {
  uspStrength: 'USP strength',
  guestAppeal: 'Guest appeal',
  clarity: 'Clarity',
  relevance: 'Property relevance',
  differentiation: 'Differentiation',
  readability: 'Readability',
  charEfficiency: 'Character efficiency',
  otaSuitability: 'OTA suitability',
};

export function scoreName(candidate, facts, ranking, limit, validation) {
  const name = candidate.name;
  const lower = name.toLowerCase();
  const segments = name.split(/[|•]/).map((s) => s.trim()).filter(Boolean);
  const wordCount = name.replace(/[|•,]/g, ' ').split(/\s+/).filter(Boolean).length;

  const includedUsps = (ranking.ranked || []).filter((usp) => {
    const label = (usp.label || '').toLowerCase();
    const short = (usp.short || '').toLowerCase();
    return (label && lower.includes(label)) || (short && lower.includes(short));
  });
  const titleUsps = includedUsps.filter((u) => u.titleWorthy);
  const commodityUsps = includedUsps.filter((u) => !u.titleWorthy);
  const topUsp = titleUsps.slice().sort((a, b) => b.strength - a.strength)[0] || null;

  const hasSize = facts.bedrooms ? new RegExp(`\\b${facts.bedrooms.value}\\s?(?:bhk|bed)`, 'i').test(name) : false;
  const hasGuests = facts.guests ? new RegExp(`\\b${facts.guests.value}\\b`).test(name) : false;
  const hasType = facts.propertyType
    ? lower.includes(String(facts.propertyType.value).toLowerCase())
      || lower.includes(String(facts.propertyType.short || '').toLowerCase())
    : false;
  const hasLocation = facts.location ? lower.includes(String(facts.location.value).toLowerCase()) : false;
  const hasBrand = facts.brand ? lower.includes(String(facts.brand.value).toLowerCase()) : false;

  const fits = new Set(facts.guestFit || []);
  const majors = (validation.violations || []).filter((v) => v.severity === 'major');

  const scores = {};

  // 1. USP strength — does it carry this property's best selling point?
  //    Divided by 105, so even a category-leading USP leaves a little headroom.
  scores.uspStrength = topUsp
    ? round(Math.min(1, topUsp.strength / 105) * WEIGHTS.uspStrength + (titleUsps.length > 1 ? 1 : 0))
    : 4;
  scores.uspStrength = Math.min(WEIGHTS.uspStrength, scores.uspStrength);

  // 2. Guest appeal — would the guest this property suits click it?
  let appeal = 5;
  if (topUsp && topUsp.tags.some((t) => fits.has(t))) appeal += 4;
  if (hasSize || hasGuests) appeal += 2;
  if (hasLocation) appeal += 2;
  if (titleUsps.length > 1) appeal += 1;
  if (commodityUsps.length) appeal -= 3;
  scores.guestAppeal = clamp(appeal, 0, WEIGHTS.guestAppeal);

  // 3. Clarity — can it be read at a glance in a search result?
  let clarity = 12;
  if (wordCount >= 4 && wordCount <= 8 && segments.length <= 3) clarity += 2;
  if (wordCount > 10) clarity -= 8;
  else if (wordCount > 8) clarity -= 4;
  else if (wordCount < 3) clarity -= 6;
  if ((name.match(/&/g) || []).length > 1) clarity -= 2;
  if (segments.length > 3) clarity -= 2;
  scores.clarity = clamp(clarity, 0, WEIGHTS.clarity);

  // 4. Relevance — how much of what we actually know is in there?
  const available = [
    facts.bedrooms ? hasSize : null,
    facts.propertyType ? hasType : null,
    facts.location ? hasLocation : null,
    (ranking.titleUsps || []).length ? titleUsps.length > 0 : null,
  ].filter((v) => v !== null);
  const used = available.filter(Boolean).length;
  scores.relevance = available.length
    ? round((used / available.length) * WEIGHTS.relevance)
    : WEIGHTS.relevance / 2;

  // 5. Differentiation — does it say anything the next listing cannot?
  let diff = 4;
  const strongUsps = titleUsps.filter((u) => u.strength >= 70);
  const standout = titleUsps.filter((u) => u.strength >= 85);
  if (strongUsps.length) {
    diff = 8;
    const head = (segments[0] || lower.slice(0, 26)).toLowerCase();
    const leadsWith = (list) => list.some((u) => head.includes(u.label.toLowerCase())
      || (u.short && head.includes(u.short.toLowerCase())));
    if (standout.length && leadsWith(standout)) diff = 12;
    else if (leadsWith(strongUsps)) diff = 11;
    else if (lower.indexOf(strongUsps[0].label.toLowerCase()) < 26) diff = 10;
  } else if (titleUsps.length) {
    diff = 6;
  }
  if (hasBrand && titleUsps.length) diff += 1;

  // A name that skips the property's single best selling point, while carrying
  // a weaker one, is doing less work than one that leads with it.
  const rankOne = (ranking.titleUsps || [])[0];
  if (rankOne) {
    if (includedUsps.some((u) => u.id === rankOne.id)) diff += 1;
    else if (titleUsps.length) diff -= 1;
  }
  scores.differentiation = clamp(diff, 0, WEIGHTS.differentiation);

  // 6. Readability
  let read = WEIGHTS.readability - 1;
  if (segments.length <= 3) read += 1;
  if (segments.length > 3) read -= 2;
  if (/\b[A-Za-z]{13,}\b/.test(name)) read -= 2;
  if (/\b(?:Mtn|Apt|TT)\b/.test(name)) read -= 1;
  scores.readability = clamp(read, 0, WEIGHTS.readability);

  // 7. Character efficiency — wasted characters are wasted shelf space.
  const fill = name.length / limit;
  let eff;
  if (fill > 1) eff = 0;
  else if (fill >= 0.92) eff = 7;
  else if (fill >= 0.68) eff = 8;
  else if (fill >= 0.55) eff = 7;
  else if (fill >= 0.45) eff = 6;
  else eff = 4;
  scores.charEfficiency = eff;

  // 8. OTA suitability
  scores.otaSuitability = clamp(WEIGHTS.otaSuitability - majors.length * 3, 0, WEIGHTS.otaSuitability);

  let total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  total -= majors.length * 6;
  total = clamp(Math.round(total), 0, 100);

  return {
    score: total,
    breakdown: Object.keys(WEIGHTS).map((key) => ({
      criterion: key,
      label: CRITERION_LABELS[key],
      points: Math.round(scores[key] * 10) / 10,
      max: WEIGHTS[key],
    })),
    reasons: buildReasons({ facts, topUsp, titleUsps, hasSize, hasType, hasLocation, hasBrand, hasGuests, name, limit, wordCount, fits }),
    issues: (validation.violations || []).map((v) => v.message),
    includedUspIds: includedUsps.map((u) => u.id),
  };
}

function buildReasons(ctx) {
  const {
    facts, topUsp, titleUsps, hasSize, hasType, hasLocation, hasBrand, hasGuests,
    name, limit, wordCount, fits,
  } = ctx;
  const reasons = [];

  if (hasSize && facts.bedrooms) reasons.push(`Communicates the ${facts.bedrooms.value}BHK size`);
  else if (hasGuests && facts.guests) reasons.push(`States the ${facts.guests.value}-guest capacity`);
  if (topUsp) {
    const isBest = titleUsps.length && topUsp.strength >= 70;
    reasons.push(isBest
      ? `Leads with the strongest USP (${topUsp.label})`
      : `Highlights a verified feature (${topUsp.label})`);
  }
  if (titleUsps.length > 1) reasons.push(`Pairs ${titleUsps[0].label} with ${titleUsps[1].label} for wider appeal`);
  if (hasLocation && facts.location) reasons.push(`Communicates the location (${facts.location.value})`);
  if (hasType && facts.propertyType) reasons.push(`Says what the property is (${facts.propertyType.value})`);
  if (hasBrand && facts.brand) reasons.push(`Keeps the existing brand name (${facts.brand.value})`);
  if (topUsp && topUsp.tags.some((t) => fits.has(t))) {
    reasons.push(`Speaks to the ${[...fits].filter((f) => topUsp.tags.includes(f))[0]} audience this property suits`);
  }
  if (wordCount >= 3 && wordCount <= 8) reasons.push(`Easy for guests to read at a glance (${wordCount} words)`);
  reasons.push(`Fits within ${limit} characters (${name.length} used)`);
  reasons.push('Avoids unnecessary keywords and promotional language');

  return reasons.slice(0, 7);
}

/** Highest score wins; ties break toward the stronger USP, then the shorter name. */
export function pickBest(scored) {
  return scored.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aUsp = a.scoring.breakdown.find((c) => c.criterion === 'uspStrength').points;
    const bUsp = b.scoring.breakdown.find((c) => c.criterion === 'uspStrength').points;
    if (bUsp !== aUsp) return bUsp - aUsp;
    return a.name.length - b.name.length;
  })[0] || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
