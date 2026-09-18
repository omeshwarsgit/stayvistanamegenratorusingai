/**
 * parsers/index.js — turn one fetched listing page into raw signals.
 *
 * Every signal carries where it came from (`source`) and the text that proved
 * it (`evidence`). Downstream code may only use facts that arrive this way, so
 * a field that could not be found stays `null` rather than being guessed.
 *
 * Source precedence, strongest first:
 *   json-ld      → the OTA's own structured data
 *   embedded     → the page's embedded app state (Airbnb/Agoda/MMT payloads)
 *   meta         → og:/meta tags, which OTAs keep accurate for sharing
 *   page-text    → read off the rendered page; correct often, but worth a look
 */

import {
  clean, toText, extractJsonLd, extractScriptJson, metaContent, pageTitle,
  firstHeading, collectStringsByKey, dedupeStrings,
} from '../html.js';

const LODGING_TYPES = /Hotel|LodgingBusiness|Apartment|House|SingleFamilyResidence|Accommodation|Resort|BedAndBreakfast|VacationRental|Product|Place|Campground|Suite|Room/i;

export function parseListing({ html = '', url = '', ota = 'unknown' }) {
  const jsonLd = extractJsonLd(html);
  const lodging = jsonLd.find((n) => LODGING_TYPES.test(String(n['@type'] || ''))) || null;
  const embedded = collectEmbedded(html, ota);
  const text = toText(html);

  const og = {
    title: metaContent(html, 'og:title'),
    description: metaContent(html, 'og:description') || metaContent(html, 'description'),
    locality: metaContent(html, 'og:locality') || metaContent(html, 'place:location:locality'),
  };

  const signals = {
    ota,
    url,
    sources: {
      jsonLd: Boolean(lodging),
      embedded: embedded.blobs.length > 0,
      meta: Boolean(og.title || og.description),
      pageText: text.length > 400,
    },
    name: pick([
      fact(lodging && lodging.name, 'json-ld', 'schema.org name'),
      fact(embedded.name, 'embedded', 'page app state'),
      fact(cleanOtaTitle(og.title, ota), 'meta', 'og:title'),
      fact(cleanOtaTitle(firstHeading(html), ota), 'page-text', 'page heading'),
      fact(cleanOtaTitle(pageTitle(html), ota), 'meta', 'page title'),
    ]),
    description: pick([
      fact(lodging && lodging.description, 'json-ld', 'schema.org description'),
      fact(embedded.description, 'embedded', 'page app state'),
      fact(og.description, 'meta', 'og:description'),
    ]),
    location: pick([
      fact(addressFromJsonLd(lodging), 'json-ld', 'schema.org address'),
      fact(embedded.location, 'embedded', 'page app state'),
      fact(og.locality, 'meta', 'og:locality'),
      fact(locationFromText(og.title, og.description, ota), 'meta', 'og tags'),
    ]),
    rating: numericFact([
      [lodging && lodging.aggregateRating && lodging.aggregateRating.ratingValue, 'json-ld', 'schema.org rating'],
      [embedded.rating, 'embedded', 'page app state'],
    ], { min: 0, max: 10 }),
    reviewCount: numericFact([
      [lodging && lodging.aggregateRating && lodging.aggregateRating.reviewCount, 'json-ld', 'schema.org reviewCount'],
      [embedded.reviewCount, 'embedded', 'page app state'],
    ], { min: 0, max: 1_000_000 }),
    amenityStrings: dedupeStrings([
      ...amenitiesFromJsonLd(lodging),
      ...embedded.amenities,
    ]).slice(0, 400),
    text,
  };

  // Counts: structured data first, then the share blurb, then the page body.
  // The body window stays near the top of the page, where every OTA puts the
  // layout row — further down a rendered page belongs to other properties.
  const blurb = [og.description, og.title, signals.name && signals.name.value].filter(Boolean).join(' . ');
  const body = text.slice(0, 8000);

  signals.bedrooms = numericFact([
    [lodging && (lodging.numberOfBedrooms || lodging.numberOfRooms), 'json-ld', 'schema.org numberOfBedrooms'],
    [embedded.bedrooms, 'embedded', 'page app state'],
    [countFrom(blurb, BEDROOM_RE), 'meta', quoteFor(blurb, BEDROOM_RE)],
    [countFrom(body, BEDROOM_RE), 'page-text', quoteFor(body, BEDROOM_RE)],
  ], { min: 1, max: 40 });

  signals.bathrooms = numericFact([
    [lodging && (lodging.numberOfBathroomsTotal || lodging.numberOfFullBathrooms), 'json-ld', 'schema.org numberOfBathrooms'],
    [embedded.bathrooms, 'embedded', 'page app state'],
    [countFrom(blurb, BATHROOM_RE), 'meta', quoteFor(blurb, BATHROOM_RE)],
    [countFrom(body, BATHROOM_RE), 'page-text', quoteFor(body, BATHROOM_RE)],
  ], { min: 1, max: 40 });

  signals.guests = numericFact([
    [occupancyFromJsonLd(lodging), 'json-ld', 'schema.org occupancy'],
    [embedded.guests, 'embedded', 'page app state'],
    [countFrom(blurb, GUEST_RE), 'meta', quoteFor(blurb, GUEST_RE)],
    [countFrom(body, GUEST_RE), 'page-text', quoteFor(body, GUEST_RE)],
  ], { min: 1, max: 100 });

  signals.beds = numericFact([
    [embedded.beds, 'embedded', 'page app state'],
    [countFrom(blurb, BED_RE), 'meta', quoteFor(blurb, BED_RE)],
  ], { min: 1, max: 60 });

  // Two zones. The trusted zone is what the listing says about *itself* — its
  // title, its description, its amenity list. The page zone is the rest of the
  // page, which on most OTAs also advertises other properties, filter labels and
  // amenity glossaries. Features found only in the page zone are reported but
  // never used to name this property.
  signals.zones = trustedZones(signals);
  signals.trustedText = signals.zones.map((z) => z.text).join('\n');
  // Anything trimmed off a long description (an appended area guide, usually)
  // joins the page zone rather than being thrown away.
  const descriptionTail = trimmedDescription(signals);
  signals.pageText = [text, descriptionTail].filter(Boolean).join('\n');
  signals.haystack = [signals.trustedText, signals.pageText].filter(Boolean).join('\n');

  signals.propertyTypeExact = fact(embedded.propertyType, 'embedded', 'page app state (propertyType)');

  // Property type, best source first. A schema.org @type comes last because
  // OTAs use it loosely (Booking.com files villas as "Hotel"), and the page
  // body comes last of all because a filter list is not a property type.
  signals.typeCandidates = [
    { text: embedded.propertyType, source: 'embedded' },
    { text: signals.name && signals.name.value, source: 'listing-title' },
    { text: og.title, source: 'meta' },
    { text: signals.amenityStrings.slice(0, 40).join('. '), source: 'amenity-list' },
    { text: signals.description && signals.description.value, source: signals.description ? signals.description.source : 'page-text' },
    { text: roomTypeLine(text), source: 'page-text' },
    { text: lodging && lodging['@type'], source: 'json-ld' },
  ].filter((c) => c.text);
  signals.typeHint = signals.typeCandidates.map((c) => c.text).join(' . ');

  return signals;
}

/**
 * Same pipeline for details the user pasted by hand, used when a listing page
 * cannot be reached. Everything here is sourced `manual`.
 */
export function parseText({ text = '', url = '', ota = 'unknown' }) {
  const body = clean(text);
  const signals = {
    ota,
    url,
    sources: { jsonLd: false, embedded: false, meta: false, pageText: false, manual: true },
    name: fact(headingLine(text), 'manual', 'First line of what you pasted'),
    description: body ? { value: body.slice(0, 4000), source: 'manual', evidence: 'Pasted by you' } : null,
    location: fact(locationFromText(null, body, ota), 'manual', 'Read from the details you pasted'),
    rating: null,
    reviewCount: null,
    amenityStrings: [],
    text: body,
  };

  signals.bedrooms = numericFact([[countFrom(body, BEDROOM_RE), 'manual', quoteFor(body, BEDROOM_RE)]], { min: 1, max: 40 });
  signals.bathrooms = numericFact([[countFrom(body, BATHROOM_RE), 'manual', quoteFor(body, BATHROOM_RE)]], { min: 1, max: 40 });
  signals.guests = numericFact([[countFrom(body, GUEST_RE), 'manual', quoteFor(body, GUEST_RE)]], { min: 1, max: 100 });
  signals.beds = numericFact([[countFrom(body, BED_RE), 'manual', quoteFor(body, BED_RE)]], { min: 1, max: 60 });
  // Everything pasted is about this property, so all of it is trusted.
  signals.zones = [{ kind: 'manual', text: body }];
  signals.trustedText = body;
  signals.pageText = '';
  signals.haystack = body;
  signals.typeHint = body.slice(0, 6000);
  return signals;
}

/**
 * The parts of a page that describe *this* property, each labelled with where it
 * came from. Kept as separate zones so a USP match can report its own source
 * without offset arithmetic, and so merging two extractions is just a concat.
 */
const DESCRIPTION_TRUST_CHARS = 1500;

/** The part of a long description that was not trusted, for the page zone. */
export function trimmedDescription(signals) {
  const text = signals.description && signals.description.value;
  return text && text.length > DESCRIPTION_TRUST_CHARS ? text.slice(DESCRIPTION_TRUST_CHARS) : '';
}

export function trustedZones(signals) {
  const zones = [];
  if (signals.name && signals.name.value) zones.push({ kind: 'listing-title', text: signals.name.value });
  if (signals.description && signals.description.value) {
    // Property copy leads; OTAs append area guides and boilerplate after it, so
    // only the opening section counts as the property describing itself.
    zones.push({
      kind: signals.description.source || 'page-text',
      text: signals.description.value.slice(0, DESCRIPTION_TRUST_CHARS),
    });
  }
  if ((signals.amenityStrings || []).length) {
    zones.push({ kind: 'amenity-list', text: signals.amenityStrings.join('. ') });
  }
  if ((signals.nearby || []).length) {
    zones.push({ kind: 'amenity-list', text: signals.nearby.join('. ') });
  }
  return zones;
}

/* ------------------------------------------------------------------ facts */

export function fact(value, source, evidence) {
  const v = clean(value == null ? '' : String(value));
  if (!v) return null;
  return { value: v, source, evidence: evidence || null };
}

export function pick(candidates) {
  return candidates.find(Boolean) || null;
}

export function numericFact(candidates, { min, max }) {
  for (const [raw, source, evidence] of candidates) {
    const n = toNumber(raw);
    if (n == null) continue;
    if (n < min || n > max) continue;
    return { value: n, source, evidence: evidence || null };
  }
  return null;
}

function toNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const m = String(raw).match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------- count regexes */

export const BEDROOM_RE = /(\d+)\s*(?:-|\s)?\s*(?:bhk\b|bed\s?rooms?\b|bedroom\b|br\b(?!and))/i;
export const BATHROOM_RE = /(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(?:bath\s?rooms?\b|baths?\b|washrooms?\b)/i;
export const GUEST_RE = /(?:(\d+)\s*(?:guests?|persons?|people|pax|adults\s+max)\b|(?:sleeps|accommodates|upto|up\s+to|max(?:imum)?\s+(?:of\s+)?)\s*(\d+)\b)/i;
export const BED_RE = /(\d+)\s*beds?\b/i;

export function countFrom(haystack, re) {
  if (!haystack) return null;
  const m = haystack.match(re);
  if (!m) return null;
  return m[1] != null ? m[1] : m[2];
}

export function quoteFor(haystack, re) {
  if (!haystack) return null;
  const m = haystack.match(re);
  if (!m || m.index == null) return null;
  const start = Math.max(0, m.index - 45);
  return `"...${clean(haystack.slice(start, m.index + m[0].length + 45))}..."`;
}

/* -------------------------------------------------------------- json-ld */

function addressFromJsonLd(node) {
  if (!node) return null;
  const a = node.address;
  if (!a) return null;
  if (typeof a === 'string') return a;
  const parts = [a.addressLocality, a.addressRegion].filter(Boolean);
  if (!parts.length && a.streetAddress) parts.push(a.streetAddress);
  return parts.join(', ') || null;
}

function occupancyFromJsonLd(node) {
  if (!node) return null;
  const o = node.occupancy;
  if (o && typeof o === 'object') return o.maxValue ?? o.value ?? null;
  return node.maximumAttendeeCapacity ?? null;
}

function amenitiesFromJsonLd(node) {
  if (!node) return [];
  const raw = node.amenityFeature;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((a) => !(a && typeof a === 'object' && a.value === false))
    .map((a) => (typeof a === 'string' ? a : a && (a.name || a.value)))
    .filter((v) => typeof v === 'string')
    .map(clean)
    .filter(Boolean);
}

/* ------------------------------------------------- embedded app payloads */

const EMBEDDED_SELECTORS = {
  airbnb: [/data-deferred-state/i, /id=["']data-state["']/i, /id=["']__NEXT_DATA__["']/i],
  agoda: [/id=["']__NEXT_DATA__["']/i, /id=["']propertyPageParams["']/i],
  makemytrip: [/id=["']__NEXT_DATA__["']/i, /id=["']__INITIAL_STATE__["']/i],
  goibibo: [/id=["']__NEXT_DATA__["']/i, /id=["']__INITIAL_STATE__["']/i],
  booking: [/type=["']application\/json["'][^>]*data-capla/i],
  unknown: [/id=["']__NEXT_DATA__["']/i],
};

/**
 * OTA payload shapes change constantly, so instead of walking fixed paths we
 * harvest values by key name and keep only what looks like listing content.
 */
function collectEmbedded(html, ota) {
  const selectors = EMBEDDED_SELECTORS[ota] || EMBEDDED_SELECTORS.unknown;
  const blobs = selectors.flatMap((re) => extractScriptJson(html, re));
  const result = {
    blobs, name: null, description: null, location: null, amenities: [], propertyType: null,
    bedrooms: null, bathrooms: null, guests: null, beds: null, rating: null, reviewCount: null,
  };
  if (!blobs.length) return result;

  const titles = [];
  const descriptions = [];
  const amenities = [];
  for (const blob of blobs) {
    titles.push(...collectStringsByKey(blob, /^(?:listingTitle|propertyName|hotelName|title|name)$/i, 60));
    descriptions.push(...collectStringsByKey(blob, /^(?:htmlDescription|descriptionText|localizedDescription|propertyDescription|description|summary)$/i, 40));
    amenities.push(...collectStringsByKey(blob, /^(?:amenit(?:y|ies)|facilit(?:y|ies)|amenityTitle|facilityName|highlight|feature)/i, 200));
    result.location = result.location || firstString(collectStringsByKey(blob, /^(?:cityName|localizedCity|city|locality|areaName|location)$/i, 20));
  }

  result.name = firstString(titles.filter((t) => t.length > 2 && t.length < 90));
  result.description = firstString(descriptions.filter((d) => d.length > 60), 1);
  for (const blob of blobs) amenities.push(...collectAmenityTitles(blob));
  result.amenities = dedupeStrings(
    amenities.filter((a) => a.length > 1 && a.length < 70 && !/^https?:/i.test(a)),
  );

  // Numbers occasionally sit in the payload as plain fields.
  const flat = blobs.map((b) => safeStringify(b)).join(' ').slice(0, 400000);
  const typeMatch = flat.match(/"(?:propertyType|accommodationType|roomTypeCategory|categoryName)"\s*:\s*"([A-Za-z][A-Za-z /'-]{2,30})"/i);
  result.propertyType = typeMatch ? clean(typeMatch[1]) : null;

  result.bedrooms = matchNum(flat, /"(?:bedroomCount|numberOfBedrooms|bedrooms)"\s*:\s*"?(\d+)/i);
  result.bathrooms = matchNum(flat, /"(?:bathroomCount|numberOfBathrooms|bathrooms)"\s*:\s*"?(\d+(?:\.\d+)?)/i);
  result.guests = matchNum(flat, /"(?:personCapacity|maxOccupancy|guestCapacity|maxGuests|capacity)"\s*:\s*"?(\d+)/i);
  result.beds = matchNum(flat, /"(?:bedCount|numberOfBeds|beds)"\s*:\s*"?(\d+)/i);
  result.rating = matchNum(flat, /"(?:starRating|ratingValue|guestRating|reviewsRating|avgRating)"\s*:\s*"?(\d(?:\.\d+)?)/i);
  result.reviewCount = matchNum(flat, /"(?:reviewsCount|reviewCount|totalReviews|numberOfReviews)"\s*:\s*"?(\d+)/i);
  return result;
}

/**
 * Amenity entries in app payloads are objects, not strings: their key is
 * `title`, and what marks them as an amenity is a neighbouring field such as
 * `__typename: 'Amenity'` or an availability flag.
 */
export function collectAmenityTitles(node, limit = 220) {
  const out = [];
  const seen = new Set();
  const visit = (value) => {
    if (out.length >= limit || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const title = typeof value.title === 'string' ? value.title : null;
    const typeName = String(value.__typename || value.type || '');
    const looksLikeAmenity = /amenit|facilit/i.test(typeName)
      || (/feature|highlight/i.test(typeName) && Object.prototype.hasOwnProperty.call(value, 'icon'))
      || (Object.prototype.hasOwnProperty.call(value, 'available')
        && Object.prototype.hasOwnProperty.call(value, 'icon'));
    if (title && looksLikeAmenity && title.length < 70 && value.available !== false) {
      out.push(clean(title));
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(node);
  return out;
}

export function firstString(list, minWords = 0) {
  for (const item of list) {
    if (!item) continue;
    if (minWords && item.split(/\s+/).length <= minWords) continue;
    return item;
  }
  return null;
}

function matchNum(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

export function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * "Entire villa in Lonavala", "Private room in apartment", "Villa in Karjat" —
 * every OTA states the accommodation type in a line like this somewhere.
 */
export function roomTypeLine(text) {
  const patterns = [
    /\b(?:entire|whole)\s+([a-z ]{3,24}?)\s+(?:in|hosted)\b/i,
    /\b(?:private|shared)\s+room\s+in\s+(?:an?\s+)?([a-z ]{3,24}?)\b/i,
    /\bproperty\s+type\s*[:-]\s*([A-Za-z ]{3,24})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  // A bare type word only means something near the top of the page, where the
  // heading and breadcrumb sit. Further down it is usually a filter label or a
  // different property.
  const bare = text.slice(0, 2500)
    .match(/\b(villa|farm\s?house|bungalow|cottage|apartment|home\s?stay|penthouse|chalet|cabin|resort|hotel|guest\s?house|haveli|tree\s?house|house\s?boat|hostel|studio)\b/i);
  return bare ? bare[0] : null;
}

/* ---------------------------------------------------------------- titles */

const OTA_TITLE_NOISE = [
  /\s*[-|·–]\s*(?:airbnb|booking\.com|makemytrip|agoda(?:\.com)?|goibibo)\b.*$/i,
  /\s*[-|·–]\s*(?:villas?|homes?|apartments?|houses?)\s+for\s+rent\s+in\b.*$/i,
  /\s*[-|·–]\s*(?:updated\s+)?\d{4}\s+prices?.*$/i,
  /\s*\|\s*book\s+.*$/i,
  /^\s*book\s+/i,
];

/**
 * When details are pasted, the first line is almost always the property name —
 * unless it reads as a sentence, in which case the name stays unknown.
 */
function headingLine(raw) {
  const first = String(raw).split(/\r?\n/).map((l) => clean(l)).find((l) => l.length > 2);
  if (!first || first.length > 80) return null;
  if (first.split(/\s+/).length > 10) return null;
  if (/[.:!?]$/.test(first)) return null;
  return first;
}

function cleanOtaTitle(title, ota) {
  if (!title) return null;
  let out = clean(title);
  for (const re of OTA_TITLE_NOISE) out = out.replace(re, '');
  if (ota === 'booking') out = out.replace(/,\s*[A-Z][a-z]+\s*[-–]\s*updated.*$/i, '');
  return clean(out) || null;
}

/**
 * Airbnb's share blurb reads "Entire villa in Karjat, India · 6 bedrooms";
 * Booking titles read "Vista Dazzle, Karjat". Both give a usable locality.
 */
export function locationFromText(title, description, ota) {
  const sources = [description, title].filter(Boolean);
  for (const src of sources) {
    // "in Karjat with mountain views" ends the place name at a lower-case word,
    // so match one or two capitalised words rather than waiting for punctuation.
    const inMatch = src.match(/\bin\s+([A-Z][A-Za-z'’.\-]{1,20}(?:\s+[A-Z][A-Za-z'’.\-]{1,20})?)\b/);
    if (inMatch) return inMatch[1].trim();
  }
  if (ota === 'booking' && title) {
    const parts = title.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[1];
  }
  return null;
}
