/**
 * Engine tests — run with `npm test`.
 *
 * These cover the parts that must never regress: the accuracy gate, the
 * character limit, USP ranking, and manual corrections. No network access and
 * no API key required.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListing, parseText } from '../lib/parsers/index.js';
import { buildFacts } from '../lib/facts.js';
import { rankUsps } from '../lib/usp.js';
import { generateNames } from '../lib/names.js';
import { buildVocabulary, validateName } from '../lib/validate.js';
import { scoreName, pickBest } from '../lib/score.js';
import { detectOta, normalizeUrl } from '../lib/ota.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'fixtures', 'airbnb-villa.html'), 'utf8');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function run(input, { limit = 50, overrides = {} } = {}) {
  const signals = typeof input === 'string'
    ? parseListing({ html: input, url: 'https://www.airbnb.co.in/rooms/12345', ota: 'airbnb' })
    : input;
  const facts = buildFacts(signals, overrides);
  const ranking = rankUsps(facts);
  const vocabulary = buildVocabulary(facts, ranking);
  const scored = generateNames(facts, ranking, { maxChars: limit })
    .map((candidate) => {
      const validation = validateName(candidate.name, facts, ranking, limit, vocabulary);
      if (!validation.ok) return { ...candidate, rejected: validation };
      return { ...candidate, validation, ...{ scoring: scoreName(candidate, facts, ranking, limit, validation) } };
    });
  const accepted = scored.filter((n) => !n.rejected).map((n) => ({ ...n, score: n.scoring.score }));
  return { facts, ranking, names: accepted, rejected: scored.filter((n) => n.rejected), best: pickBest(accepted) };
}

/* ------------------------------------------------- 1. URL + OTA detection */

check('Airbnb URL detected', detectOta('https://www.airbnb.co.in/rooms/12345').id === 'airbnb');
check('Booking URL detected', detectOta('https://www.booking.com/hotel/in/vista.html').id === 'booking');
check('MakeMyTrip URL detected', detectOta('https://www.makemytrip.com/hotels/vista-details.html').id === 'makemytrip');
check('Agoda URL detected', detectOta('https://www.agoda.com/vista/hotel/karjat-in.html').id === 'agoda');
check('Goibibo URL detected', detectOta('https://www.goibibo.com/hotels/vista-hotel-in-karjat/').id === 'goibibo');
check('Bare host accepted', normalizeUrl('airbnb.co.in/rooms/1').ok);
check('Localhost rejected', !normalizeUrl('http://localhost:8080/x').ok);
check('Private IP rejected', !normalizeUrl('http://192.168.1.10/x').ok);
check('Non-http rejected', !normalizeUrl('ftp://example.com/x').ok);

/* ------------------------------------------------------- 2. Fact extraction */

const base = run(html);
const f = base.facts;

check('Property name extracted', f.name && f.name.value === 'Vista Dazzle', f.name && f.name.value);
check('Brand extracted', f.brand && f.brand.value === 'Vista Dazzle', f.brand && f.brand.value);
check('Location extracted', f.location && f.location.value === 'Karjat', f.location && f.location.value);
check('Bedrooms extracted', f.bedrooms && f.bedrooms.value === 6, f.bedrooms && String(f.bedrooms.value));
check('Guests extracted', f.guests && f.guests.value === 12, f.guests && String(f.guests.value));
check('Bathrooms extracted', f.bathrooms && f.bathrooms.value === 6.5, f.bathrooms && String(f.bathrooms.value));
check('Property type detected', f.propertyType && f.propertyType.value === 'Villa', f.propertyType && f.propertyType.value);
check('Rating extracted', f.rating && f.rating.value === 4.87, f.rating && String(f.rating.value));
check('Every fact carries a source', ['name', 'location', 'bedrooms', 'guests'].every((k) => f[k] && f[k].source));
check('Every fact carries evidence', ['bedrooms', 'guests'].every((k) => f[k] && f[k].evidence));
check('Coverage is complete for this fixture', !f.coverage.partial, f.coverage.missing.join(','));

/* ------------------------------------------------------------ 3. USP ranking */

const ids = base.ranking.titleUsps.map((u) => u.id);
check('Private Pool identified (listing says private)', ids.includes('private_pool'), ids.join(','));
check('Hilltop identified', ids.includes('hilltop'));
check('Pool table identified', ids.includes('pool_table'));
check('Large lawn identified over plain lawn', ids.includes('large_lawn') && !ids.includes('lawn'));
check('BBQ identified', ids.includes('bbq'));
check('Bonfire identified', ids.includes('bonfire'));
check('Mountain view identified', ids.includes('mountain_view'));
check('Pool ranks above pool table', base.ranking.titleUsps[0].id === 'private_pool', base.ranking.titleUsps[0].id);
check('Wi-Fi is not a title USP', !ids.includes('wifi'));
check('Parking is not a title USP', !ids.includes('parking'));
check('Wi-Fi listed as a commodity', base.ranking.commodities.some((u) => u.id === 'wifi'));
check('Only one pool USP survives', base.ranking.ranked.filter((u) => u.category === 'pool').length === 1);
check('Pool table is not read as a pool', !base.ranking.ranked.some((u) => u.id === 'pool'));
check('Ranked USPs carry a reason', base.ranking.titleUsps.every((u) => Array.isArray(u.reasons)));
check('Group fit derived from size', f.guestFit.includes('group'), f.guestFit.join(','));

/* ----------------------------------------------------------- 4. Name output */

check('At least 10 names generated', base.names.length >= 10, `got ${base.names.length}`);
check('No name exceeds the limit', base.names.every((n) => n.name.length <= 50), base.names.filter((n) => n.name.length > 50).map((n) => n.name).join(' | '));
check('A best name is chosen', Boolean(base.best));
check('Best name scores well', base.best.score >= 80, `score ${base.best.score}`);
check('Best name mentions the top USP', /pool/i.test(base.best.name), base.best.name);
check('Best name has reasons', base.best.scoring.reasons.length >= 4);
check('Best name breakdown covers 8 criteria', base.best.scoring.breakdown.length === 8);
check('Names come in multiple styles', new Set(base.names.map((n) => n.style)).size >= 3, [...new Set(base.names.map((n) => n.style))].join(','));
check('A brand-style name exists', base.names.some((n) => n.style === 'brand' && n.name.includes('Vista Dazzle')));
check('No name repeats a word', base.names.every((n) => {
  const words = n.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return new Set(words).size === words.length;
}), base.names.map((n) => n.name).join(' | '));
check('No name contains banned patterns', base.names.every((n) => !/book now|₹|www\.|!/i.test(n.name)));
check('Every name reports its character count', base.names.every((n) => n.length === n.name.length));

/* -------------------------------------------------- 5. Accuracy gate (hard) */

const genericPoolHtml = html
  .replace(/Private swimming pool/g, 'Swimming pool')
  .replace(/private\s*\n?\s*swimming pool/gi, 'swimming pool')
  .replace(/hilltop/gi, 'quiet spot')
  .replace(/large lawn/gi, 'lawn')
  .replace(/Large lawn/g, 'Lawn')
  .replace(/sweeping mountain views/gi, 'green surroundings');
const generic = run(genericPoolHtml);
const genericIds = generic.ranking.ranked.map((u) => u.id);

check('Generic pool is not upgraded to Private Pool', !genericIds.includes('private_pool'), genericIds.join(','));
check('Plain pool detected instead', genericIds.includes('pool'));
check('Hilltop not claimed without evidence', !genericIds.includes('hilltop'));
check('Large Lawn not claimed without evidence', !genericIds.includes('large_lawn') && genericIds.includes('lawn'));
check('Mountain view not claimed without evidence', !genericIds.includes('mountain_view'));
check('No generated name says "Private"', generic.names.every((n) => !/private/i.test(n.name)), generic.names.map((n) => n.name).join(' | '));
check('No generated name says "Panoramic"', generic.names.every((n) => !/panoramic/i.test(n.name)));
check('No generated name says "Luxury" without evidence', generic.names.every((n) => !/luxur/i.test(n.name)));

const gv = buildVocabulary(generic.facts, generic.ranking);
const invented = [
  '6BHK Private Pool Villa • Karjat',
  '6BHK Villa • Panoramic Views • Karjat',
  'Luxury 6BHK Villa • Pool • Karjat',
  '6BHK Villa • Pool • Karjat • Book Now',
  '6BHK BEACHFRONT VILLA • Karjat',
  '8BHK Villa • Pool • Karjat',
  '6BHK Villa • Pool • Karjat • Call 9876543210',
  '6BHK Villa • Best Pool in India • Karjat',
  '6BHK Villa with Jacuzzi • Pool • Karjat',
];
for (const name of invented) {
  const v = validateName(name, generic.facts, generic.ranking, 50, gv);
  check(`Rejected invented claim: "${name}"`, !v.ok, v.violations.map((x) => x.id).join(','));
}
const honest = validateName('6BHK Villa • Pool & Games • Karjat', generic.facts, generic.ranking, 50, gv);
check('Accepted an accurate name', honest.ok, honest.violations.map((x) => x.message).join('; '));

/* ------------------------------------------------- 6. Character limit ladder */

for (const limit of [30, 35, 40, 50, 60]) {
  const tight = run(html, { limit });
  check(`Limit ${limit}: every name fits`, tight.names.every((n) => n.name.length <= limit),
    tight.names.filter((n) => n.name.length > limit).map((n) => `${n.name} (${n.name.length})`).join(' | '));
  check(`Limit ${limit}: names still produced`, tight.names.length >= 3, `got ${tight.names.length}`);
  check(`Limit ${limit}: best name keeps a USP or location`, tight.best && /pool|karjat|games|lawn|hilltop|bbq|bonfire|mtn|mountain/i.test(tight.best.name), tight.best && tight.best.name);
  check(`Limit ${limit}: nothing truncated mid-word`, tight.names.every((n) => !/\w\.\.\.$|\w-$/.test(n.name)));
}

/* ---------------------------------------------------- 7. Manual corrections */

const corrected = run(html, {
  overrides: {
    addUsps: ['Panoramic mountain view'],
    removeUsps: ['bbq'],
    location: 'Karjat',
    bedrooms: 5,
  },
});
const correctedIds = corrected.ranking.ranked.map((u) => u.id);
check('Manual USP added', correctedIds.includes('panoramic_view'), correctedIds.join(','));
check('Manual USP is usable in a title', corrected.names.some((n) => /panoramic|views/i.test(n.name))
  || corrected.ranking.titleUsps.some((u) => u.id === 'panoramic_view'));
check('Removed USP is gone', !correctedIds.includes('bbq'));
check('Manual bedroom count used', corrected.facts.bedrooms.value === 5 && corrected.facts.bedrooms.source === 'manual');
check('Names reflect the corrected size', corrected.names.every((n) => !/6\s?BHK/i.test(n.name)), corrected.names.map((n) => n.name).join(' | '));

const freeform = run(html, { overrides: { addUsps: ['Cricket pitch'] } });
check('Unknown manual USP kept verbatim', freeform.ranking.ranked.some((u) => u.label === 'Outdoor Games' || u.label === 'Cricket Pitch'));

/* ------------------------------------------------------- 8. Pasted-text mode */

const pasted = parseText({
  text: '4 BHK farm house in Lonavala, sleeps 10 guests. Has a private pool, a bonfire area and a large garden. Free wifi and parking.',
  url: '',
  ota: 'unknown',
});
const manual = run(pasted);
check('Pasted text yields bedrooms', manual.facts.bedrooms && manual.facts.bedrooms.value === 4, manual.facts.bedrooms && String(manual.facts.bedrooms.value));
check('Pasted text yields guests', manual.facts.guests && manual.facts.guests.value === 10);
check('Pasted text yields property type', manual.facts.propertyType && manual.facts.propertyType.value === 'Farm House', manual.facts.propertyType && manual.facts.propertyType.value);
check('Pasted text yields USPs', manual.ranking.titleUsps.some((u) => u.id === 'private_pool'));
check('Pasted text still produces names', manual.names.length >= 3, `got ${manual.names.length}`);
check('Pasted facts are marked manual', manual.facts.bedrooms.source === 'manual');

/* ------------------------------------------------- 9. Sparse listing safety */

const sparse = parseText({ text: 'Nice place to stay.', url: '', ota: 'unknown' });
const sparseRun = run(sparse);
check('Sparse listing reports partial coverage', sparseRun.facts.coverage.partial);
check('Sparse listing lists what is missing', sparseRun.facts.coverage.missing.length >= 3, sparseRun.facts.coverage.missing.join(','));
check('Sparse listing does not invent names', sparseRun.names.length === 0 || sparseRun.names.every((n) => /stay|place/i.test(n.name)), sparseRun.names.map((n) => n.name).join(' | '));

/* -------------------------------------------------------- 10. Apartment case */

const apartmentSignals = parseText({
  text: '2 BHK apartment in Bandra, Mumbai. Sea view balcony, high-speed wifi, dedicated workspace, gym in the building. Sleeps 4 guests. Lawn in the complex.',
  url: '',
  ota: 'unknown',
});
const apartment = run(apartmentSignals);
const aptTop = apartment.ranking.titleUsps[0];
check('Apartment leads with the view', aptTop && aptTop.id === 'sea_view', aptTop && aptTop.id);
check('Lawn demoted for an apartment', (() => {
  const lawn = apartment.ranking.ranked.find((u) => u.category === 'lawn');
  return !lawn || lawn.strength < 60;
})(), String((apartment.ranking.ranked.find((u) => u.category === 'lawn') || {}).strength));
check('Apartment names fit the limit', apartment.names.every((n) => n.name.length <= 50));
check('Apartment best name names the view', apartment.best && /sea/i.test(apartment.best.name), apartment.best && apartment.best.name);

/* -------------------------------------------------------------- 11. Scoring */

const scores = base.names.map((n) => n.score);
check('Scores are within 0-100', scores.every((s) => s >= 0 && s <= 100));
check('Scores differentiate names', new Set(scores).size > 1);
check('Best name is the top score', base.best.score === Math.max(...scores));
check('Commodity-only name scores lower than USP name', (() => {
  const v = validateName('6BHK Villa • Wi-Fi & Parking • Karjat', f, base.ranking, 50, buildVocabulary(f, base.ranking));
  if (!v.ok) return true;
  const weak = scoreName({ name: '6BHK Villa • Wi-Fi & Parking • Karjat' }, f, base.ranking, 50, v);
  return weak.score < base.best.score;
})());

/* ---------------------------------------------------------------- summary */

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  console.log('');
  process.exit(1);
}
console.log('  Sample output for the fixture listing:');
console.log(`  BEST  ${base.best.name}  (${base.best.name.length}/50, score ${base.best.score}, ${base.best.styleLabel})`);
for (const n of base.names.filter((n) => n !== base.best).slice(0, 8)) {
  console.log(`        ${n.name}  (${n.name.length}/50, score ${n.score}, ${n.styleLabel})`);
}
console.log('');
