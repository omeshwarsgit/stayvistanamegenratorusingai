/**
 * parsers/adapters.js — what we know about each OTA, and how to approach it.
 *
 * Extraction order is the same everywhere (HTML → JSON → embedded JSON →
 * OTA-specific → rendered browser), but the adapter says which of those are
 * worth trying first for a given OTA, what a "no content" reply looks like
 * there, and what to tell the user when nothing works.
 *
 * Measured against live listing URLs on 2026-09-10; re-check when an OTA
 * changes and update `note` so the dashboard stays honest.
 */

const COMMON_JSON_KEYS = {
  name: /^(?:hotelName|propertyName|listingName|listingTitle|displayName|title|name)$/i,
  description: /^(?:htmlDescription|propertyDescription|longDescription|descriptionText|description|summary|about|overview)$/i,
  location: /^(?:cityName|localizedCity|city|locality|areaName|area|neighbourhood|neighborhood|location|destination|addressLocality)$/i,
  propertyType: /^(?:propertyType|accommodationType|categoryName|hotelType|roomTypeCategory|starCategory)$/i,
  amenities: /^(?:amenit(?:y|ies)|facilit(?:y|ies)|amenityName|facilityName|amenityTitle)/i,
  highlights: /^(?:highlight|usp|uniqueSellingPoint|sellingPoint|keyFeature|feature|tag)/i,
  nearby: /^(?:nearby|nearBy|attraction|landmark|poi|pointOfInterest|distance)/i,
};

/** A body this short that only says "OK" is a health probe, not a listing. */
const STATUS_STUB = /^\W*(?:\d{3}\s*[-–]?\s*)?ok\W*$/i;

export const ADAPTERS = {
  stayvista: {
    id: 'stayvista',
    label: 'StayVista',
    source: true,
    strategies: ['html', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/id=["']__NEXT_DATA__["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: false,
    note: 'StayVista publishes its properties in full — a schema.org block plus the page payload, including the amenities a property does not have.',
  },
  airbnb: {
    id: 'airbnb',
    label: 'Airbnb',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/data-deferred-state/i, /id=["']data-state["']/i, /id=["']__NEXT_DATA__["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: false,
    note: 'Airbnb serves the listing to a direct request; content sits in the page app state.',
  },
  booking: {
    id: 'booking',
    label: 'Booking.com',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/type=["']application\/json["'][^>]*data-capla/i, /id=["']__NEXT_DATA__["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: false,
    gated: true,
    note: 'Booking.com answers automated requests with a bot-protection challenge, which this tool does not attempt to satisfy.',
  },
  agoda: {
    id: 'agoda',
    label: 'Agoda',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/id=["']__NEXT_DATA__["']/i, /id=["']propertyPageParams["']/i, /data-selenium=["']script-initparam["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: true,
    note: 'Agoda ships an empty shell and fills it in the browser, so the page has to be rendered to be read.',
  },
  makemytrip: {
    id: 'makemytrip',
    label: 'MakeMyTrip',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/id=["']__NEXT_DATA__["']/i, /id=["']__INITIAL_STATE__["']/i, /id=["']app-state["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: true,
    stubPattern: STATUS_STUB,
    note: 'MakeMyTrip replies to requests outside its own site session with a six-byte "200-OK" placeholder instead of the listing — there is no listing data in the response to parse, rendered or not.',
  },
  goibibo: {
    id: 'goibibo',
    label: 'Goibibo',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/id=["']__NEXT_DATA__["']/i, /id=["']__INITIAL_STATE__["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: true,
    stubPattern: STATUS_STUB,
    note: 'Goibibo (same group as MakeMyTrip) replies with a "200 - OK" placeholder instead of the listing.',
  },
  unknown: {
    id: 'unknown',
    label: 'Unrecognised OTA',
    strategies: ['html', 'json', 'embedded', 'ota', 'render'],
    embeddedSelectors: [/id=["']__NEXT_DATA__["']/i, /id=["']__INITIAL_STATE__["']/i],
    jsonKeys: COMMON_JSON_KEYS,
    clientRendered: false,
    note: 'Not one of the five supported OTAs — generic extraction was used, so check the extracted fields.',
  },
};

export function adapterFor(otaId) {
  return ADAPTERS[otaId] || ADAPTERS.unknown;
}

/**
 * True when a response carries no listing at all — an "OK" sentinel or a body
 * too small to hold a property. Distinguishing this from a parse failure is
 * what lets the tool explain *why* nothing could be read.
 */
export function isStubResponse(body, adapter) {
  const text = String(body || '').trim();
  if (!text) return true;
  if (text.length <= 64 && STATUS_STUB.test(stripJsonWrapping(text))) return true;
  if (adapter && adapter.stubPattern && text.length <= 256 && adapter.stubPattern.test(stripJsonWrapping(text))) return true;
  return false;
}

function stripJsonWrapping(text) {
  return text
    .replace(/^[[{"']+|[\]}"']+$/g, '')
    .replace(/^\s*(?:status|message|result)\s*:\s*/i, '')
    .trim();
}
