/**
 * Extraction tests — the strategy chain, JSON responses and zoning.
 *
 * Run with `npm test` (after the engine tests). No network access and no API
 * key required: every case is a fixture.
 */

import { parseJson, countFields } from '../lib/parsers/json.js';
import { parseListing, parseText } from '../lib/parsers/index.js';
import { isStubResponse, adapterFor } from '../lib/parsers/adapters.js';
import { factsFromUrl } from '../lib/urlfacts.js';
import { OTA_PROFILES, candidatesFor, fitForProfile } from '../lib/otastyle.js';
import { nameSlots } from '../lib/names.js';
import {
  saveCapture, findCapture, captureStatus, captureToken, captureToHtml,
  trustedSection, amenityLines, clearCapture,
} from '../lib/capture.js';
import { merge } from '../lib/extract.js';
import { buildFacts } from '../lib/facts.js';
import { rankUsps } from '../lib/usp.js';
import { generateNames } from '../lib/names.js';
import { buildVocabulary, validateName } from '../lib/validate.js';
import { scoreName } from '../lib/score.js';

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function pipeline(signals, { limit = 50, overrides = {} } = {}) {
  const facts = buildFacts(signals, overrides);
  const ranking = rankUsps(facts);
  const vocabulary = buildVocabulary(facts, ranking);
  const names = generateNames(facts, ranking, { maxChars: limit })
    .map((candidate) => {
      const validation = validateName(candidate.name, facts, ranking, limit, vocabulary);
      return validation.ok
        ? { ...candidate, score: scoreName(candidate, facts, ranking, limit, validation).score }
        : null;
    })
    .filter(Boolean);
  return { facts, ranking, names };
}

/* ------------------------------------------- 1. JSON responses are not failures */

// Shaped like an OTA property API: nested, with the fields under key names.
const API_PAYLOAD = {
  status: 'success',
  data: {
    property: {
      propertyName: 'Mehta Mansion Villa',
      accommodationType: 'Villa',
      cityName: 'Lonavala',
      propertyDescription: 'A 5 bedroom villa in Lonavala with a private pool, a large lawn, '
        + 'a pool table and a bonfire pit. Sweeping valley views from the terrace.',
      noOfBedrooms: '5',
      noOfBathrooms: 5,
      maxGuests: 12,
      guestRating: '4.6',
      reviewsCount: 88,
      amenities: [
        { amenityName: 'Private pool', available: true, icon: 'pool' },
        { amenityName: 'Pool table', available: true, icon: 'games' },
        { amenityName: 'Bonfire', available: true, icon: 'fire' },
        { amenityName: 'Barbecue', available: true, icon: 'bbq' },
        { amenityName: 'Free WiFi', available: true, icon: 'wifi' },
        { amenityName: 'Car parking', available: true, icon: 'parking' },
      ],
      nearby: [{ landmark: 'Lonavala railway station' }],
    },
  },
};

const api = parseJson({ body: JSON.stringify(API_PAYLOAD), url: 'https://example.com/x', ota: 'makemytrip' });
check('JSON response parses into signals', api.ok, api.message);
check('JSON gives the property name', api.ok && api.signals.name.value === 'Mehta Mansion Villa', api.ok && api.signals.name.value);
check('JSON gives the location', api.ok && api.signals.location.value === 'Lonavala', api.ok && api.signals.location.value);
check('JSON gives the property type', api.ok && api.signals.propertyTypeExact.value === 'Villa');
check('JSON gives bedrooms', api.ok && api.signals.bedrooms.value === 5, api.ok && String(api.signals.bedrooms.value));
check('JSON gives bathrooms', api.ok && api.signals.bathrooms.value === 5);
check('JSON gives guest capacity', api.ok && api.signals.guests.value === 12);
check('JSON gives the rating', api.ok && api.signals.rating.value === 4.6);
check('JSON gives amenities', api.ok && api.signals.amenityStrings.length >= 5, api.ok && String(api.signals.amenityStrings.length));
check('JSON facts are sourced api', api.ok && api.signals.bedrooms.source === 'api');
check('JSON field count is reported', api.ok && api.fieldCount >= 8, api.ok && String(api.fieldCount));

const apiRun = pipeline(api.signals);
check('JSON payload yields USPs', apiRun.ranking.titleUsps.some((u) => u.id === 'private_pool'),
  apiRun.ranking.titleUsps.map((u) => u.id).join(','));
check('JSON payload yields names', apiRun.names.length >= 5, `got ${apiRun.names.length}`);
check('JSON payload names fit the limit', apiRun.names.every((n) => n.name.length <= 50));
check('JSON payload names use the verified size', apiRun.names.every((n) => !/[^5]BHK/i.test(n.name)),
  apiRun.names.map((n) => n.name).join(' | '));

/* --------------------------------------------------- 2. Stub responses are named */

check('MakeMyTrip 200-OK body is a stub', isStubResponse('200-OK', adapterFor('makemytrip')));
check('Goibibo 200 - OK body is a stub', isStubResponse('200 - OK', adapterFor('goibibo')));
check('Quoted JSON status is a stub', isStubResponse('"200-OK"', adapterFor('makemytrip')));
check('Empty body is a stub', isStubResponse('', adapterFor('airbnb')));
check('A real page is not a stub', !isStubResponse('<html><body>Vista Dazzle, 6 bedroom villa in Karjat with a private pool</body></html>', adapterFor('booking')));
check('A real JSON payload is not a stub', !isStubResponse(JSON.stringify(API_PAYLOAD), adapterFor('makemytrip')));

const stub = parseJson({ body: '200-OK', url: 'https://www.makemytrip.com/hotels/x-details-lonavala.html', ota: 'makemytrip' });
check('Stub JSON is reported as a stub', !stub.ok && stub.reason === 'stub', stub.reason);
check('Stub message states the size', !stub.ok && /6-byte/.test(stub.message), stub.message);
check('Stub message names the OTA', !stub.ok && /MakeMyTrip/.test(stub.message));

const emptyJson = parseJson({ body: JSON.stringify({ meta: { page: 1 }, results: [] }), ota: 'agoda' });
check('JSON without listing fields is reported', !emptyJson.ok && emptyJson.reason === 'no-listing-fields', emptyJson.reason);

const brokenJson = parseJson({ body: 'not json at all {', ota: 'agoda' });
check('Unparseable JSON is reported', !brokenJson.ok, brokenJson.reason);

/* ------------------------------------- 3. Page-zone features cannot name a property */

// A rendered SPA page: the listing itself is a plain city apartment, but the
// page also advertises other properties and a filter list.
const CONTAMINATED = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Hotel","name":"City Central Apartment",
 "description":"A 2 bedroom apartment in Pune with air conditioning and fast wifi.",
 "address":{"@type":"PostalAddress","addressLocality":"Pune"}}
</script></head><body>
<h1>City Central Apartment</h1>
<p>Entire apartment in Pune. 4 guests, 2 bedrooms, 2 bathrooms.</p>
<section id="similar">
  <h2>Other properties you may like</h2>
  <ul>
    <li>Hilltop Farm House with a private pool and river view</li>
    <li>Beachfront villa with a jacuzzi, bonfire and pool table</li>
  </ul>
</section>
<section id="filters">Property type: Farm House, Villa, Bungalow. Amenities: Swimming pool, BBQ, Large lawn.</section>
</body></html>`;

const contaminated = pipeline(parseListing({ html: CONTAMINATED, url: 'https://www.agoda.com/x/hotel/pune-in.html', ota: 'agoda' }));
const confirmedIds = contaminated.ranking.titleUsps.map((u) => u.id);
const unconfirmedIds = (contaminated.ranking.unconfirmed || []).map((u) => u.id);

check('The listing itself is identified', contaminated.facts.name.value === 'City Central Apartment', contaminated.facts.name.value);
check('Its own type wins over the filter list', contaminated.facts.propertyType.value === 'Apartment', contaminated.facts.propertyType && contaminated.facts.propertyType.value);
check('Its own location is used', contaminated.facts.location.value === 'Pune');
check('A neighbouring pool is not confirmed', !confirmedIds.includes('private_pool') && !confirmedIds.includes('pool'), confirmedIds.join(','));
check('A neighbouring river view is not confirmed', !confirmedIds.includes('river_view'));
check('A neighbouring jacuzzi is not confirmed', !confirmedIds.includes('jacuzzi'));
check('Page-zone features are still reported', unconfirmedIds.length >= 3, unconfirmedIds.join(','));
check('Unconfirmed features are flagged', (contaminated.ranking.unconfirmed || []).every((u) => u.confirmed === false));
check('No name claims a neighbouring feature', contaminated.names.every((n) => !/pool|jacuzzi|river|beachfront|hilltop|bonfire/i.test(n.name)),
  contaminated.names.map((n) => n.name).join(' | '));
check('Own amenities still register', contaminated.ranking.commodities.some((u) => u.id === 'wifi' || u.id === 'ac'),
  contaminated.ranking.commodities.map((u) => u.id).join(','));

const contaminatedVocab = buildVocabulary(contaminated.facts, contaminated.ranking);
for (const invented of [
  '2BHK Apartment • Private Pool • Pune',
  '2BHK Apartment • River View • Pune',
  '2BHK Beachfront Apartment • Pune',
]) {
  const v = validateName(invented, contaminated.facts, contaminated.ranking, 50, contaminatedVocab);
  check(`Page-zone claim rejected: "${invented}"`, !v.ok, v.violations.map((x) => x.id).join(','));
}

// Confirming one by hand makes it usable, which is the documented escape hatch.
const confirmedByHand = pipeline(
  parseListing({ html: CONTAMINATED, url: 'https://www.agoda.com/x/hotel/pune-in.html', ota: 'agoda' }),
  { overrides: { addUsps: ['Swimming pool'] } },
);
check('A hand-confirmed feature becomes usable',
  confirmedByHand.ranking.titleUsps.some((u) => u.category === 'pool'),
  confirmedByHand.ranking.titleUsps.map((u) => u.id).join(','));
check('And it can then appear in a name', confirmedByHand.names.some((n) => /pool/i.test(n.name)),
  confirmedByHand.names.map((n) => n.name).join(' | '));

// A neighbour's stronger wording must not displace this property's own feature.
const RIVAL_WORDING = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Hotel","name":"Mehta Mansion",
 "description":"A 4 bedroom villa in Lonavala with a private swimming pool and a large lawn.",
 "address":{"@type":"PostalAddress","addressLocality":"Lonavala"}}
</script></head><body>
<h1>Mehta Mansion</h1>
<section id="similar">Similar properties: Cliffside Villa with an infinity pool and a jacuzzi</section>
</body></html>`;

const rival = pipeline(parseListing({ html: RIVAL_WORDING, url: 'https://example.com/r', ota: 'unknown' }));
const rivalPool = rival.ranking.titleUsps.find((u) => u.category === 'pool');
check('The property keeps its own pool wording', rivalPool && rivalPool.id === 'private_pool',
  rivalPool ? rivalPool.id : 'no pool at all');
check('A neighbour stronger wording does not become the property feature',
  !rival.ranking.titleUsps.some((u) => u.id === 'infinity_pool'));
check('And it is still reported as unconfirmed',
  (rival.ranking.unconfirmed || []).some((u) => u.id === 'infinity_pool' || u.id === 'jacuzzi'),
  (rival.ranking.unconfirmed || []).map((u) => u.id).join(','));
check('A name can use the confirmed pool', rival.names.some((n) => /private pool|pool/i.test(n.name)),
  rival.names.map((n) => n.name).join(' | '));
check('No name claims the infinity pool', rival.names.every((n) => !/infinity/i.test(n.name)));

/* ---------------------------------------------------- 4. Merging across strategies */

const partialHtml = parseListing({
  html: `<!doctype html><html><head><title>Vista Dazzle</title>
    <meta property="og:title" content="Vista Dazzle - Villa in Karjat" /></head>
    <body><h1>Vista Dazzle</h1></body></html>`,
  url: 'https://example.com/a',
  ota: 'unknown',
});
const partialJson = parseJson({
  body: JSON.stringify({ property: { noOfBedrooms: 6, maxGuests: 12, amenities: [{ amenityName: 'Private pool' }, { amenityName: 'Bonfire' }, { amenityName: 'Pool table' }] } }),
  url: 'https://example.com/a',
  ota: 'unknown',
});
const mergedSignals = merge(partialHtml, partialJson.ok ? partialJson.signals : null);

check('Merge keeps the earlier name', mergedSignals.name && /^Vista Dazzle/.test(mergedSignals.name.value),
  mergedSignals.name && mergedSignals.name.value);
check('Merge adds the later counts', mergedSignals.bedrooms && mergedSignals.bedrooms.value === 6);
check('Merge unions amenities', (mergedSignals.amenityStrings || []).length >= 3, String((mergedSignals.amenityStrings || []).length));
check('Merge produces more fields than either half',
  countFields(mergedSignals) > Math.max(countFields(partialHtml), partialJson.ok ? countFields(partialJson.signals) : 0));

const mergedRun = pipeline(mergedSignals);
check('Merged signals produce names', mergedRun.names.length >= 3, `got ${mergedRun.names.length}`);
check('Merged names respect the limit', mergedRun.names.every((n) => n.name.length <= 50));

/* --------------------------------------- 5. The character limit holds everywhere */

for (const limit of [20, 25, 30, 42, 50, 64, 120]) {
  const run = pipeline(api.signals, { limit });
  check(`Limit ${limit}: no name exceeds it`, run.names.every((n) => n.name.length <= limit),
    run.names.filter((n) => n.name.length > limit).map((n) => `${n.name} (${n.name.length})`).join(' | '));
}

const outOfRange = pipeline(api.signals, { limit: 500 });
check('An out-of-range limit is clamped to 120', outOfRange.names.every((n) => n.name.length <= 120));

/* ------------------------------------------------------- 6. Pasted page source */

const pastedSource = parseListing({ html: CONTAMINATED, url: '', ota: 'unknown' });
check('Pasted page source parses like a fetched page', pastedSource.name && pastedSource.name.value === 'City Central Apartment');
const pastedProse = parseText({ text: 'Mehta Mansion Villa\n5 BHK villa in Lonavala, sleeps 12. Private pool, pool table, bonfire.', ota: 'makemytrip' });
check('Pasted prose is all trusted', pastedProse.pageText === '');
const proseRun = pipeline(pastedProse);
check('Pasted prose confirms its USPs', proseRun.ranking.titleUsps.some((u) => u.id === 'private_pool'));
check('Pasted prose has no unconfirmed leftovers', (proseRun.ranking.unconfirmed || []).length === 0);

/* ------------------------------------------- 7. Facts carried by the URL itself */

const urlCases = [
  ['makemytrip', 'https://www.makemytrip.com/hotels/stayvista_mehta_mansion_villa-details-lonavala.html', 'StayVista Mehta Mansion Villa', 'Lonavala', 'Villa'],
  ['goibibo', 'https://www.goibibo.com/hotels/stayvista-at-mehta-mansion-hotel-in-lonavala-3479174379933953981/', 'StayVista at Mehta Mansion', 'Lonavala', null],
  ['agoda', 'https://www.agoda.com/stayvista-mehta-mansion/hotel/lonavala-in.html', 'StayVista Mehta Mansion', 'Lonavala', null],
  ['booking', 'https://www.booking.com/hotel/in/stayvista-at-mehta-mansion.html', 'StayVista at Mehta Mansion', null, null],
];
for (const [ota, url, name, city, type] of urlCases) {
  const r = factsFromUrl(url, ota);
  check(`URL facts (${ota}): name`, r.ok && r.signals.name.value === name, r.ok ? r.signals.name.value : r.note);
  if (city) {
    check(`URL facts (${ota}): city`, r.ok && r.signals.location && r.signals.location.value === city,
      r.ok && r.signals.location ? r.signals.location.value : 'none');
  }
  if (type) {
    check(`URL facts (${ota}): type`, r.ok && r.signals.propertyTypeExact && r.signals.propertyTypeExact.value === type);
  }
  check(`URL facts (${ota}): sourced url`, r.ok && r.signals.name.source === 'url');
}
check('A numeric Airbnb path yields no URL facts',
  !factsFromUrl('https://www.airbnb.co.in/rooms/1761784157549536392', 'airbnb').ok);
check('A BHK in the slug is read', (() => {
  const r = factsFromUrl('https://www.makemytrip.com/hotels/4bhk_pool_villa-details-goa.html', 'makemytrip');
  return r.ok && r.signals.bedrooms && r.signals.bedrooms.value === 4;
})());

const urlOnly = pipeline(factsFromUrl(urlCases[0][1], 'makemytrip').signals);
check('URL facts alone still produce a name', urlOnly.names.length >= 1, `got ${urlOnly.names.length}`);
check('URL-only names stay within the limit', urlOnly.names.every((n) => n.name.length <= 50));
check('URL-only names score modestly', urlOnly.names.every((n) => n.score <= 80),
  urlOnly.names.map((n) => `${n.name}:${n.score}`).join(' | '));

/* ------------------------------------------------- 8. The browser-capture route */

const CAPTURE_URL = 'https://www.makemytrip.com/hotels/test_villa-details-lonavala.html';
const CAPTURE_MAIN = `Test Villa Lonavala
Entire Villa - 4 Bedrooms - Sleeps 10 Guests

About this property
Set on a hilltop with valley views, this villa has a private swimming pool, a large lawn and a bonfire pit.

Amenities
Private Pool
Large Lawn
Bonfire
Free WiFi
Free Parking

Similar properties in Lonavala
Cliffside Villa with an infinity pool, jacuzzi and home theatre`;

check('A capture without the session token is refused',
  !saveCapture({ token: 'wrong', url: CAPTURE_URL, text: CAPTURE_MAIN }).ok);
check('A capture without a URL is refused',
  !saveCapture({ token: captureToken(), text: CAPTURE_MAIN }).ok);
check('An empty capture is refused',
  !saveCapture({ token: captureToken(), url: CAPTURE_URL, text: '', main: '' }).ok);

const saved = saveCapture({
  token: captureToken(),
  url: CAPTURE_URL,
  title: 'Test Villa, Lonavala | MakeMyTrip',
  main: CAPTURE_MAIN,
  text: CAPTURE_MAIN,
  meta: { 'og:description': '4 BHK villa in Lonavala, sleeps 10 guests', 'x-secret': 'should be dropped' },
  ld: [],
});
check('A valid capture is stored', saved.ok, saved.error);
check('The capture is found by URL', (findCapture(CAPTURE_URL) || {}).looseMatch === false);
check('Capture status reports it', captureStatus(CAPTURE_URL).found === true);
check('Only whitelisted meta keys survive',
  !JSON.stringify(findCapture(CAPTURE_URL).meta).includes('should be dropped'));

const record = findCapture(CAPTURE_URL);
check('The trusted section stops at other properties', !/infinity pool/i.test(trustedSection(record)),
  trustedSection(record).slice(-60));
check('The trusted section keeps the property copy', /private swimming pool/i.test(trustedSection(record)));
check('Amenity lines are read from the list', amenityLines(record).includes('Private Pool'),
  amenityLines(record).join(','));
check('Amenity lines stop before the next section',
  !amenityLines(record).some((a) => /similar|cliffside/i.test(a)));

const captureSignals = parseListing({ html: captureToHtml(record), url: CAPTURE_URL, ota: 'makemytrip' });
captureSignals.zones = [
  ...(captureSignals.zones || []),
  { kind: 'capture', text: trustedSection(record) },
  { kind: 'amenity-list', text: amenityLines(record).join('. ') },
];
captureSignals.trustedText = captureSignals.zones.map((z) => z.text).join('\n');
const captureRun = pipeline(captureSignals);
const captureIds = captureRun.ranking.titleUsps.map((u) => u.id);

check('Capture confirms the property pool', captureIds.includes('private_pool'), captureIds.join(','));
check('Capture confirms the hilltop setting', captureIds.includes('hilltop'));
check('Capture confirms the lawn', captureIds.some((id) => id === 'large_lawn' || id === 'lawn'));
check('A neighbour infinity pool stays out of the confirmed set', !captureIds.includes('infinity_pool'));
check('A neighbour jacuzzi stays out of the confirmed set', !captureIds.includes('jacuzzi'));
check('Capture yields the layout', captureRun.facts.bedrooms && captureRun.facts.bedrooms.value === 4,
  captureRun.facts.bedrooms && String(captureRun.facts.bedrooms.value));
check('Capture yields the guest capacity', captureRun.facts.guests && captureRun.facts.guests.value === 10);
check('Capture produces names', captureRun.names.length >= 5, `got ${captureRun.names.length}`);
check('Capture names respect the limit', captureRun.names.every((n) => n.name.length <= 50));
check('Capture names claim nothing from the neighbour',
  captureRun.names.every((n) => !/infinity|jacuzzi|theatre/i.test(n.name)),
  captureRun.names.map((n) => n.name).join(' | '));
clearCapture(CAPTURE_URL);
check('A capture can be cleared', !captureStatus(CAPTURE_URL).found);

/* -------------------- 9. A property name may contain a gated claim word */

const NAMED_INFINITY = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Hotel","name":"The Infinity Heaven",
 "description":"A 4 bedroom villa in New Delhi with a private pool and a manicured lawn.",
 "address":{"@type":"PostalAddress","addressLocality":"New Delhi"},"numberOfBedrooms":4}
</script></head><body><h1>The Infinity Heaven</h1></body></html>`;

const named = pipeline(parseListing({ html: NAMED_INFINITY, url: 'https://www.stayvista.com/villa/the-infinity-heaven', ota: 'stayvista' }));
const namedVocab = buildVocabulary(named.facts, named.ranking);

check('The property name is read', named.facts.name.value === 'The Infinity Heaven', named.facts.name.value);
check('Its own name may be used in a title',
  validateName('Infinity Heaven | 4BHK Pvt Pool Villa, New Delhi', named.facts, named.ranking, 50, namedVocab).ok,
  validateName('Infinity Heaven | 4BHK Pvt Pool Villa, New Delhi', named.facts, named.ranking, 50, namedVocab).violations.map((v) => v.message).join('; '));
check('A brand-led name is offered', named.names.some((n) => /Infinity Heaven/i.test(n.name)),
  named.names.map((n) => n.name).join(' | '));
check('But the stronger pool wording is still refused',
  !validateName('4BHK Villa | Infinity Pool, New Delhi', named.facts, named.ranking, 50, namedVocab).ok);
check('And the refusal says why',
  /claims more than the page confirms/.test(
    validateName('4BHK Villa | Infinity Pool, New Delhi', named.facts, named.ranking, 50, namedVocab)
      .violations.map((v) => v.message).join('; '),
  ));
check('An unmentioned feature phrase is refused',
  !validateName('4BHK Villa | Private Beach, New Delhi', named.facts, named.ranking, 50, namedVocab).ok);
check('The confirmed pool wording still passes',
  validateName('4BHK Villa | Private Pool, New Delhi', named.facts, named.ranking, 50, namedVocab).ok);

/* ------------------------------------------------ 10. One title per OTA */

const OTA_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Hotel","name":"Bel Air Mansion",
 "description":"A 4 bedroom villa in Lonavala set in a secluded spot, with a private swimming pool, a large lawn and a jacuzzi.",
 "address":{"@type":"PostalAddress","addressLocality":"Lonavala"},
 "numberOfBedrooms":4,"occupancy":{"@type":"QuantitativeValue","maxValue":11}}
</script></head><body><h1>Bel Air Mansion</h1></body></html>`;

const otaRun = pipeline(parseListing({ html: OTA_PAGE, url: 'https://www.stayvista.com/villa/bel-air-mansion', ota: 'stayvista' }));
const otaSlots = nameSlots(otaRun.facts, otaRun.ranking);
const otaVocab = buildVocabulary(otaRun.facts, otaRun.ranking);

const picked = new Map();
for (const profile of OTA_PROFILES) {
  const list = candidatesFor(profile, otaSlots);
  check(`${profile.label}: has candidates`, list.length > 0);

  let chosen = null;
  for (const raw of list) {
    const fitted = fitForProfile(raw, profile);
    if (!fitted) continue;
    if (!validateName(fitted.name, otaRun.facts, otaRun.ranking, profile.maxChars, otaVocab).ok) continue;
    chosen = fitted.name;
    break;
  }
  check(`${profile.label}: produced a title`, Boolean(chosen), list.join(' | '));
  if (!chosen) continue;
  picked.set(profile.id, chosen);

  check(`${profile.label}: within its own ceiling`, chosen.length <= profile.maxChars, `${chosen} (${chosen.length})`);
  check(`${profile.label}: within 50 characters`, chosen.length <= 50, `${chosen} (${chosen.length})`);
  check(`${profile.label}: claims nothing unconfirmed`,
    !/bonfire|bbq|home theatre|beachfront|infinity/i.test(chosen), chosen);
}

check('Airbnb leaves the city out', !/lonavala/i.test(picked.get('airbnb') || ''), picked.get('airbnb'));
check('Airbnb avoids pipe separators', !(picked.get('airbnb') || '').includes('|'), picked.get('airbnb'));
check('Booking.com leads with the house name', /^Bel Air Mansion/.test(picked.get('booking') || ''), picked.get('booking'));
check('MakeMyTrip keeps the city', /lonavala/i.test(picked.get('makemytrip') || ''), picked.get('makemytrip'));
check('MakeMyTrip uses BHK', /\dBHK/.test(picked.get('makemytrip') || ''), picked.get('makemytrip'));
check('Agoda spells out the bedroom count', /\d-Bedroom/.test(picked.get('agoda') || ''), picked.get('agoda'));
check('Agoda avoids BHK', !/BHK/.test(picked.get('agoda') || ''), picked.get('agoda'));
check('Agoda keeps the city', /lonavala/i.test(picked.get('agoda') || ''), picked.get('agoda'));
check('Goibibo keeps the city', /lonavala/i.test(picked.get('goibibo') || ''), picked.get('goibibo'));
check('Every OTA got a different emphasis', new Set(picked.values()).size >= 4,
  [...picked.values()].join(' | '));

// A tight limit must still leave every platform with something legal.
for (const profile of OTA_PROFILES) {
  const tight = { ...profile, maxChars: 32, allowAbbrev: true };
  const fitted = candidatesFor(tight, otaSlots).map((raw) => fitForProfile(raw, tight)).find(Boolean);
  check(`${profile.label}: still fits at 32 characters`, Boolean(fitted) && fitted.name.length <= 32,
    fitted ? `${fitted.name} (${fitted.name.length})` : 'nothing fitted');
}

/* ---------------------------------------------------------------- summary */

console.log(`\n  extraction: ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  console.log('');
  process.exit(1);
}
