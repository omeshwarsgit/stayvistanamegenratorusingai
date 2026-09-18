/**
 * parsers/json.js — read a JSON response as a listing.
 *
 * `Content-Type: application/json` is not a failure. Several OTAs answer a
 * listing URL with an API payload, and the property is in there — just under
 * key names rather than markup. This parser mines the payload by key name
 * (never by a fixed path, which no OTA keeps stable) and produces the same
 * signal shape as the HTML parser, sourced `api`.
 *
 * It also recognises the opposite case: a payload that carries no listing at
 * all, such as MakeMyTrip's six-byte `200-OK` placeholder. Saying "this reply
 * contained no listing" is more useful than pretending the parse failed.
 */

import { clean, collectStringsByKey, dedupeStrings, tryParseJson } from '../html.js';
import {
  fact, pick, numericFact, countFrom, quoteFor, roomTypeLine, locationFromText,
  collectAmenityTitles, firstString, safeStringify, trustedZones,
  BEDROOM_RE, BATHROOM_RE, GUEST_RE, BED_RE,
} from './index.js';
import { adapterFor, isStubResponse } from './adapters.js';

const JUNK_STRING = /^(?:https?:\/\/|data:|\/[\w/.-]*$|#[0-9a-f]{3,8}$|[0-9a-f]{16,}$|[A-Za-z0-9+/]{40,}={0,2}$)/i;

/**
 * @param {{body?: string, json?: unknown, url?: string, ota?: string}} input
 * @returns {{ok: boolean, reason?: string, message?: string, signals?: object, fieldCount?: number}}
 */
export function parseJson({ body = '', json = undefined, url = '', ota = 'unknown' }) {
  const adapter = adapterFor(ota);
  const raw = typeof body === 'string' ? body : safeStringify(body);

  if (isStubResponse(raw, adapter)) {
    return {
      ok: false,
      reason: 'stub',
      message: `${adapter.label} answered with a ${raw.trim().length}-byte placeholder (${JSON.stringify(clean(raw).slice(0, 24))}) instead of listing data.`,
    };
  }

  const payload = json !== undefined ? json : tryParseJson(raw);
  if (payload === null || payload === undefined) {
    return { ok: false, reason: 'unparseable', message: 'The response claimed to be JSON but could not be parsed.' };
  }
  if (typeof payload !== 'object') {
    return {
      ok: false,
      reason: 'not-a-listing',
      message: `The JSON response was a single ${typeof payload} value, not a property listing.`,
    };
  }

  const keys = adapter.jsonKeys;
  const flat = safeStringify(payload).slice(0, 600_000);

  const names = collectStringsByKey(payload, keys.name, 80)
    .filter((v) => v.length > 2 && v.length < 90 && !JUNK_STRING.test(v));
  const descriptions = collectStringsByKey(payload, keys.description, 40)
    .filter((v) => v.length > 60 && !JUNK_STRING.test(v));
  const locations = collectStringsByKey(payload, keys.location, 30)
    .filter((v) => v.length > 1 && v.length < 60 && !JUNK_STRING.test(v));
  const types = collectStringsByKey(payload, keys.propertyType, 20)
    .filter((v) => v.length > 2 && v.length < 32 && !JUNK_STRING.test(v));

  const amenities = dedupeStrings([
    ...collectStringsByKey(payload, keys.amenities, 250),
    ...collectAmenityTitles(payload, 250),
    ...collectStringsByKey(payload, keys.highlights, 80),
  ].filter((v) => v.length > 1 && v.length < 70 && !JUNK_STRING.test(v)));

  const nearby = dedupeStrings(
    collectStringsByKey(payload, keys.nearby, 60).filter((v) => v.length > 2 && v.length < 80 && !JUNK_STRING.test(v)),
  );

  // Everything textual in the payload, so the USP matcher can see prose that
  // sits under key names we did not anticipate.
  const allText = dedupeStrings(
    collectStringsByKey(payload, /.*/, 2500).filter((v) => v.length > 2 && !JUNK_STRING.test(v)),
  ).join('. ');

  const signals = {
    ota,
    url,
    sources: { jsonLd: false, embedded: false, meta: false, pageText: false, api: true },
    name: fact(firstString(names), 'api', 'JSON response field'),
    description: fact(firstString(descriptions, 1), 'api', 'JSON response field'),
    location: pick([
      fact(firstString(locations), 'api', 'JSON response field'),
      fact(locationFromText(firstString(names), firstString(descriptions, 1), ota), 'api', 'read from JSON text'),
    ]),
    rating: numericFact([
      [matchNum(flat, /"(?:starRating|ratingValue|guestRating|reviewsRating|avgRating|rating)"\s*:\s*"?(\d(?:\.\d+)?)/i), 'api', 'JSON response field'],
    ], { min: 0, max: 10 }),
    reviewCount: numericFact([
      [matchNum(flat, /"(?:reviewsCount|reviewCount|totalReviews|numberOfReviews)"\s*:\s*"?(\d+)/i), 'api', 'JSON response field'],
    ], { min: 0, max: 1_000_000 }),
    amenityStrings: amenities.slice(0, 400),
    nearby,
    text: allText,
  };

  const blurb = [signals.name && signals.name.value, signals.description && signals.description.value]
    .filter(Boolean).join(' . ');

  signals.bedrooms = numericFact([
    [matchNum(flat, /"(?:bedroomCount|numberOfBedrooms|bedrooms|noOfBedrooms|bhk)"\s*:\s*"?(\d+)/i), 'api', 'JSON response field'],
    [countFrom(blurb, BEDROOM_RE), 'api', quoteFor(blurb, BEDROOM_RE)],
    [countFrom(allText, BEDROOM_RE), 'api', quoteFor(allText, BEDROOM_RE)],
  ], { min: 1, max: 40 });

  signals.bathrooms = numericFact([
    [matchNum(flat, /"(?:bathroomCount|numberOfBathrooms|bathrooms|noOfBathrooms)"\s*:\s*"?(\d+(?:\.\d+)?)/i), 'api', 'JSON response field'],
    [countFrom(blurb, BATHROOM_RE), 'api', quoteFor(blurb, BATHROOM_RE)],
    [countFrom(allText, BATHROOM_RE), 'api', quoteFor(allText, BATHROOM_RE)],
  ], { min: 1, max: 40 });

  signals.guests = numericFact([
    [matchNum(flat, /"(?:personCapacity|maxOccupancy|guestCapacity|maxGuests|occupancy|capacity|maxAdults)"\s*:\s*"?(\d+)/i), 'api', 'JSON response field'],
    [countFrom(blurb, GUEST_RE), 'api', quoteFor(blurb, GUEST_RE)],
    [countFrom(allText, GUEST_RE), 'api', quoteFor(allText, GUEST_RE)],
  ], { min: 1, max: 100 });

  signals.beds = numericFact([
    [matchNum(flat, /"(?:bedCount|numberOfBeds|beds)"\s*:\s*"?(\d+)/i), 'api', 'JSON response field'],
    [countFrom(allText, BED_RE), 'api', quoteFor(allText, BED_RE)],
  ], { min: 1, max: 60 });

  signals.propertyTypeExact = fact(firstString(types), 'api', 'JSON response field (property type)');

  signals.zones = trustedZones(signals);
  signals.trustedText = signals.zones.map((z) => z.text).join('\n');
  // Payloads also carry recommendations and neighbouring properties, so
  // everything beyond this property's own fields counts as the page zone.
  signals.pageText = allText;
  signals.haystack = [signals.trustedText, allText].filter(Boolean).join('\n');

  signals.typeHint = [
    firstString(types),
    signals.name && signals.name.value,
    signals.description && signals.description.value,
    signals.amenityStrings.slice(0, 40).join('. '),
    roomTypeLine(allText),
  ].filter(Boolean).join(' . ');

  const fieldCount = countFields(signals);
  if (!fieldCount) {
    return {
      ok: false,
      reason: 'no-listing-fields',
      message: 'The JSON response parsed, but held no property fields.',
    };
  }
  return { ok: true, signals, fieldCount };
}

/** How much of a listing a set of signals actually describes. */
export function countFields(signals) {
  if (!signals) return 0;
  let count = 0;
  for (const key of ['name', 'location', 'description', 'bedrooms', 'bathrooms', 'guests', 'beds', 'rating', 'propertyTypeExact']) {
    if (signals[key]) count += 1;
  }
  if ((signals.amenityStrings || []).length >= 3) count += 1;
  return count;
}

function matchNum(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}
