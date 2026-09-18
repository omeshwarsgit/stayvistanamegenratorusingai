/**
 * parsers/stayvista.js — read a StayVista property page.
 *
 * StayVista is the *source of truth* for this tool, not one of the OTAs, and it
 * publishes its properties generously: a schema.org `Hotel` block with the name,
 * layout and available amenities, and a `__NEXT_DATA__` payload with the city,
 * occupancy, highlights and — the part that matters most for accuracy — an
 * explicit list of amenities the property does **not** have.
 *
 * That denial list is honoured. A villa whose page lists "Bonfire" under
 * unavailable can never be named for a bonfire, even if the word appears
 * elsewhere in the page copy.
 */

import {
  clean, toText, extractJsonLd, extractScriptJson, pageTitle, dedupeStrings,
} from '../html.js';
import {
  fact, pick, numericFact, countFrom, quoteFor, trustedZones,
  BEDROOM_RE, BATHROOM_RE, GUEST_RE,
} from './index.js';

const LODGING = /Hotel|LodgingBusiness|House|Apartment|VacationRental|Resort|Accommodation/i;

/** "Book Your Luxurious Stay @ Bel Air Mansion - Talegaon In Lonavala, Maharashtra from StayVista" */
const TITLE_SHAPE = /(?:stay|villa|home)\s*(?:@|at)\s*(.+?)\s+in\s+([A-Za-z][A-Za-z\s'’.-]+?)(?:,|\s+from\s+stayvista|$)/i;

export function parseStayVista({ html = '', url = '' }) {
  const jsonLd = extractJsonLd(html);
  const lodging = jsonLd.find((n) => LODGING.test(String(n['@type'] || ''))) || null;
  const product = jsonLd.find((n) => /Product/i.test(String(n['@type'] || ''))) || null;
  const property = propertyPayload(html);
  const text = toText(html);
  const title = pageTitle(html) || '';
  const titleParts = title.match(TITLE_SHAPE);

  const amenityBlock = findAmenityBlock(extractScriptJson(html, /id=["']__NEXT_DATA__["']/i));
  const available = availableAmenities(lodging, property, amenityBlock);
  const denied = deniedAmenities(property, amenityBlock);

  const signals = {
    ota: 'stayvista',
    url,
    sources: {
      jsonLd: Boolean(lodging),
      embedded: Boolean(property),
      meta: Boolean(title),
      pageText: text.length > 400,
      stayvista: true,
    },
    name: pick([
      fact(lodging && lodging.name, 'json-ld', 'schema.org name'),
      fact(product && product.name, 'json-ld', 'schema.org name'),
      fact(property && (property.name || property.property_name), 'embedded', 'page data'),
      fact(titleParts && titleParts[1], 'meta', `page title "${title}"`),
    ]),
    description: pick([
      fact(stripTags(property && property.highlights), 'embedded', 'page highlights'),
      fact(lodging && lodging.description, 'json-ld', 'schema.org description'),
    ]),
    location: pick([
      fact(cityOf(property), 'embedded', 'page data (city)'),
      fact(titleParts && titleParts[2], 'meta', `page title "${title}"`),
      fact(addressOf(lodging), 'json-ld', 'schema.org address'),
    ]),
    rating: numericFact([
      [lodging && lodging.aggregateRating && lodging.aggregateRating.ratingValue, 'json-ld', 'schema.org rating'],
      [product && product.aggregateRating && product.aggregateRating.ratingValue, 'json-ld', 'schema.org rating'],
    ], { min: 0, max: 5 }),
    reviewCount: numericFact([
      [lodging && lodging.aggregateRating && (lodging.aggregateRating.reviewCount || lodging.aggregateRating.ratingCount), 'json-ld', 'schema.org reviewCount'],
    ], { min: 0, max: 1_000_000 }),
    amenityStrings: available,
    deniedTerms: denied,
    text,
  };

  const blurb = [
    signals.name && signals.name.value,
    signals.description && signals.description.value,
    title,
  ].filter(Boolean).join(' . ');

  signals.bedrooms = numericFact([
    [lodging && (lodging.numberOfBedrooms || lodging.numberOfRooms), 'json-ld', 'schema.org numberOfBedrooms'],
    [property && (property.number_of_rooms || property.no_of_bedrooms), 'embedded', 'page data (number_of_rooms)'],
    [countFrom(blurb, BEDROOM_RE), 'meta', quoteFor(blurb, BEDROOM_RE)],
  ], { min: 1, max: 40 });

  signals.bathrooms = numericFact([
    [lodging && lodging.numberOfBathroomsTotal, 'json-ld', 'schema.org numberOfBathrooms'],
    [bathroomsOf(property), 'embedded', 'page data (bathrooms)'],
    [countFrom(blurb, BATHROOM_RE), 'meta', quoteFor(blurb, BATHROOM_RE)],
  ], { min: 1, max: 40 });

  // StayVista publishes a range; the OTA-facing capacity is the maximum.
  signals.guests = numericFact([
    [property && property.max_occupancy, 'embedded', 'page data (max_occupancy)'],
    [lodging && lodging.occupancy && (lodging.occupancy.maxValue || lodging.occupancy.value), 'json-ld', 'schema.org occupancy'],
    [countFrom(blurb, GUEST_RE), 'meta', quoteFor(blurb, GUEST_RE)],
  ], { min: 1, max: 100 });

  signals.beds = null;
  signals.propertyTypeExact = fact(typeOf(property, url), 'embedded', 'StayVista property type');

  // What the property says about itself: its name, its highlights, and the
  // amenity list StayVista publishes as available.
  signals.zones = trustedZones(signals);
  signals.trustedText = signals.zones.map((z) => z.text).join('\n');
  signals.pageText = text;
  signals.haystack = [signals.trustedText, text].filter(Boolean).join('\n');

  signals.typeCandidates = [
    { text: signals.propertyTypeExact ? signals.propertyTypeExact.value : '', source: 'embedded' },
    { text: signals.name && signals.name.value, source: 'listing-title' },
    { text: title, source: 'meta' },
    { text: available.join('. '), source: 'amenity-list' },
    { text: signals.description && signals.description.value, source: 'embedded' },
  ].filter((c) => c.text);
  signals.typeHint = signals.typeCandidates.map((c) => c.text).join(' . ');

  return signals;
}

/* ----------------------------------------------------------- page payload */

/** The property object inside `__NEXT_DATA__`, wherever the app has put it. */
function propertyPayload(html) {
  const blobs = extractScriptJson(html, /id=["']__NEXT_DATA__["']/i);
  for (const blob of blobs) {
    const found = findProperty(blob);
    if (found) return found;
  }
  return null;
}

function findProperty(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findProperty(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const looksLikeProperty = ('max_occupancy' in node) || ('number_of_rooms' in node && 'city' in node);
  if (looksLikeProperty) return node;
  for (const value of Object.values(node)) {
    const hit = findProperty(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/* -------------------------------------------------------------- amenities */

/**
 * Amenities StayVista publishes as present. The schema.org block carries the
 * headline set; the page payload adds the categorised list. Anything the page
 * marks unavailable is excluded here and denied outright below.
 */
/**
 * The amenities block, wherever the page app keeps it: an object with a list of
 * `{name}` entries and, usually, an `unavailable` sibling.
 */
function findAmenityBlock(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 9) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findAmenityBlock(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const looksLikeBlock = Object.entries(node).some(([key, value]) => (
    /^(?:sorted|available|unavailable|list|all)$/i.test(key)
    && Array.isArray(value)
    && value.some((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string')
  ));
  if (looksLikeBlock) return node;
  for (const value of Object.values(node)) {
    const hit = findAmenityBlock(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function availableAmenities(lodging, property, amenityBlock) {
  const fromSchema = (lodging && Array.isArray(lodging.amenityFeature) ? lodging.amenityFeature : [])
    .filter((a) => a && a.value !== false)
    .map((a) => clean(a.name))
    .filter(Boolean);

  const fromPayload = [];
  const amenities = amenityBlock || (property && property.amenities);
  if (amenities && typeof amenities === 'object') {
    for (const [group, list] of Object.entries(amenities)) {
      if (/unavailable|missing|absent/i.test(group)) continue;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        // Real amenities carry an icon and a parent category; a bare `name` is
        // one of the group headings ("Kitchen", "Common Amenities").
        if (!entry || (!entry.icon && !entry.parent_name)) continue;
        const name = entry.name || entry.label;
        if (typeof name === 'string' && name.trim()) fromPayload.push(clean(name));
      }
    }
  }

  const tags = Array.isArray(property && property.tags)
    ? property.tags
      .filter((t) => t && (!t.type || t.type === 'feature'))
      .map((t) => clean(t.name || t.label))
      // A slashed tag is a search category ("Pool / Jacuzzi"), not a feature.
      .filter((name) => name && !name.includes('/') && !MARKETING_TAG.test(name))
    : [];

  const denied = new Set(deniedAmenities(property, amenityBlock).map((d) => d.toLowerCase()));
  return dedupeStrings([...fromSchema, ...fromPayload, ...tags])
    .filter((name) => !denied.has(name.toLowerCase()))
    .slice(0, 300);
}

/** Loyalty and ranking labels StayVista attaches for merchandising. */
const MARKETING_TAG = /^(?:best\s+rated|top\s+rated|new(?:ly)?\s+(?:added|listed)|trending|popular|marriott\s+bonvoy|bonvoy|luxe|premium\s+collection|sale|deal)$/i;

/** Amenities the page explicitly lists as unavailable. */
function deniedAmenities(property, amenityBlock) {
  const amenities = amenityBlock || (property && property.amenities);
  if (!amenities || typeof amenities !== 'object') return [];
  const out = [];
  for (const [group, list] of Object.entries(amenities)) {
    if (!/unavailable|missing|absent/i.test(group)) continue;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const name = entry && (entry.name || entry.label);
      if (typeof name === 'string' && name.trim()) out.push(clean(name));
    }
  }
  return dedupeStrings(out);
}

/* ---------------------------------------------------------------- fields */

function cityOf(property) {
  if (!property) return null;
  const city = property.city || (property.location && property.location.city);
  return typeof city === 'string' ? city : null;
}

function addressOf(lodging) {
  const address = lodging && lodging.address;
  if (!address) return null;
  if (typeof address === 'string') return address;
  return address.addressLocality || address.addressRegion || null;
}

function bathroomsOf(property) {
  if (!property) return null;
  const priv = Number(property.no_of_private_bathrooms) || 0;
  const shared = Number(property.no_of_shared_bathrooms) || 0;
  const total = priv + shared;
  return total > 0 ? total : null;
}

/** StayVista sells villas, so the URL segment is a reliable type signal. */
const RENTAL_DESCRIPTOR = /^(?:entire|private|shared)\s+(?:place|home|house|room|apartment|unit)$/i;

/**
 * StayVista sells villas, and its `property_type` field carries a rental
 * descriptor ("entire place") rather than a building type — so the URL segment
 * and the slug are the better signals.
 */
function typeOf(property, url) {
  const declared = property && (property.property_type || property.type);
  if (typeof declared === 'string' && declared.length < 24 && !RENTAL_DESCRIPTOR.test(declared.trim())) {
    return declared;
  }
  const slug = String(url || '').toLowerCase();
  for (const [re, label] of [
    [/farm\s?house|farmhouse/, 'Farm House'],
    [/bungalow/, 'Bungalow'],
    [/cottage/, 'Cottage'],
    [/apartment|\bflat\b/, 'Apartment'],
    [/penthouse/, 'Penthouse'],
    [/\bvillas?\b/, 'Villa'],
  ]) {
    if (re.test(slug)) return label;
  }
  return null;
}

function stripTags(value) {
  if (typeof value !== 'string') return null;
  return clean(value.replace(/<[^>]*>/g, ' '));
}
