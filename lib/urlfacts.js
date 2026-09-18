/**
 * urlfacts.js — the facts already present in the URL the user pasted.
 *
 * Every OTA encodes the property name, and usually the city, in the listing
 * path: `/hotels/stayvista_mehta_mansion_villa-details-lonavala.html`. When the
 * page itself cannot be read, this is real, public, checkable information — not
 * a guess — so it seeds the fact sheet and lets the analysis start instead of
 * dead-ending on an error.
 *
 * It is deliberately modest: a name, a city, sometimes a property type or a BHK
 * count. Everything is sourced `url` so the dashboard shows where it came from
 * and the user can correct it.
 */

import { titleCase } from './facts.js';

/** Structural words in a path that are not part of the property name. */
const PATH_NOISE = /^(?:hotels?|details?|property|properties|listing|page|in|at|near|book|booking)$/i;

const TYPE_WORDS = [
  [/\bfarm\s?house\b/i, 'Farm House'],
  [/\bguest\s?house\b/i, 'Guest House'],
  [/\bhouse\s?boat\b/i, 'Houseboat'],
  [/\btree\s?house\b/i, 'Treehouse'],
  [/\bpent\s?house\b/i, 'Penthouse'],
  [/\bhome\s?stay\b/i, 'Homestay'],
  [/\bvillas?\b/i, 'Villa'],
  [/\bbungalow\b/i, 'Bungalow'],
  [/\bcottage\b/i, 'Cottage'],
  [/\bapartment\b/i, 'Apartment'],
  [/\bhaveli\b/i, 'Haveli'],
  [/\bchalet\b/i, 'Chalet'],
  [/\bcabin\b/i, 'Cabin'],
  [/\bresort\b/i, 'Resort'],
];

/**
 * @returns {{ok: boolean, signals?: object, fields?: number, note?: string}}
 */
export function factsFromUrl(url, ota) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, note: 'the URL could not be parsed' };
  }

  const parts = parsed.pathname.split('/').map(decodeSegment).filter(Boolean);
  const raw = extractSlugs(parts, ota, parsed);
  if (!raw.nameSlug) return { ok: false, note: 'the URL path carries no property slug' };

  const name = slugToTitle(raw.nameSlug);
  if (!name || name.length < 3) return { ok: false, note: 'the URL slug did not resolve to a name' };

  const evidence = `From the URL path "${parsed.pathname}"`;
  const signals = {
    ota,
    url,
    sources: { jsonLd: false, embedded: false, meta: false, pageText: false, url: true },
    name: { value: name, source: 'url', evidence },
    description: null,
    location: raw.citySlug ? { value: slugToTitle(raw.citySlug), source: 'url', evidence } : null,
    rating: null,
    reviewCount: null,
    amenityStrings: [],
    text: '',
  };

  const typeHit = TYPE_WORDS.find(([re]) => re.test(name));
  signals.propertyTypeExact = typeHit ? { value: typeHit[1], source: 'url', evidence } : null;

  // Read from the resolved name rather than the raw slug: an underscore is a
  // word character, so "4bhk_pool_villa" defeats a word boundary after "bhk".
  const bhk = name.match(/(\d+)\s*bhk\b/i);
  signals.bedrooms = bhk ? { value: Number(bhk[1]), source: 'url', evidence } : null;
  signals.bathrooms = null;
  signals.guests = null;
  signals.beds = null;

  // The name is all we can vouch for, so it is the only trusted zone.
  signals.zones = [{ kind: 'url', text: name }];
  signals.trustedText = name;
  signals.pageText = '';
  signals.haystack = name;
  signals.typeCandidates = [
    { text: signals.propertyTypeExact ? signals.propertyTypeExact.value : '', source: 'url' },
    { text: name, source: 'url' },
  ].filter((c) => c.text);
  signals.typeHint = signals.typeCandidates.map((c) => c.text).join(' . ');

  const fields = ['name', 'location', 'propertyTypeExact', 'bedrooms'].filter((k) => signals[k]).length;
  return { ok: true, signals, fields };
}

/* ------------------------------------------------------------ per-OTA paths */

function extractSlugs(parts, ota, parsed) {
  const last = parts[parts.length - 1] || '';
  const bare = last.replace(/\.(?:html?|php|aspx)$/i, '');

  if (ota === 'makemytrip') {
    // /hotels/<name>-details-<city>.html
    const m = bare.match(/^(.*?)-details-(.*)$/i);
    if (m) return { nameSlug: m[1], citySlug: m[2] };
    return { nameSlug: bare, citySlug: null };
  }

  if (ota === 'goibibo') {
    // /hotels/<name>-hotel-in-<city>-<id>/
    const m = bare.match(/^(.*?)-hotels?-in-(.*?)(?:-\d{6,})?$/i);
    if (m) return { nameSlug: m[1], citySlug: m[2] };
    return { nameSlug: bare.replace(/-\d{6,}$/, ''), citySlug: null };
  }

  if (ota === 'agoda') {
    // /<name>/hotel/<city>-<cc>.html
    const hotelIndex = parts.findIndex((p) => /^hotel$/i.test(p));
    const nameSlug = hotelIndex > 0 ? parts[hotelIndex - 1] : parts[0];
    const cityPart = hotelIndex >= 0 ? (parts[hotelIndex + 1] || '') : '';
    const citySlug = cityPart.replace(/\.(?:html?)$/i, '').replace(/-[a-z]{2}$/i, '');
    return { nameSlug: (nameSlug || '').replace(/_\d+$/, ''), citySlug: citySlug || null };
  }

  if (ota === 'booking') {
    // /hotel/<cc>/<name>.html
    const idx = parts.findIndex((p) => /^hotel$/i.test(p));
    const nameSlug = idx >= 0 ? (parts[idx + 2] || parts[idx + 1] || '') : bare;
    return { nameSlug: nameSlug.replace(/\.(?:html?)$/i, '').replace(/\.[a-z]{2}$/i, ''), citySlug: null };
  }

  if (ota === 'airbnb') {
    // Numeric room ids carry nothing usable.
    return { nameSlug: null, citySlug: null };
  }

  // Unknown OTA: the last path segment is the best guess, and the host is not.
  if (!bare || /^\d+$/.test(bare) || bare.length < 4) return { nameSlug: null, citySlug: null };
  return { nameSlug: bare, citySlug: parsed.searchParams.get('city') || null };
}

/* ---------------------------------------------------------------- helpers */

function decodeSegment(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Brand names the URL lower-cased on the way in. */
const BRAND_CASING = [
  [/^stayvista$/i, 'StayVista'],
  [/^makemytrip$/i, 'MakeMyTrip'],
  [/^goibibo$/i, 'Goibibo'],
  [/^oyo$/i, 'OYO'],
  [/^itc$/i, 'ITC'],
  [/^jw$/i, 'JW'],
  [/^bnb$/i, 'BnB'],
  [/^bhk$/i, 'BHK'],
];

function fixCase(word) {
  const hit = BRAND_CASING.find(([re]) => re.test(word));
  return hit ? hit[1] : null;
}

function slugToTitle(slug) {
  const words = String(slug || '')
    .replace(/[_+]/g, '-')
    .split('-')
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w, i, all) => !(PATH_NOISE.test(w) && all.length > 1 && i === all.length - 1))
    .filter((w) => !/^\d{5,}$/.test(w));
  if (!words.length) return null;
  const cased = words.map((word) => fixCase(word) || word);
  return titleCase(cased.join(' '))
    .split(' ')
    .map((word) => fixCase(word) || word)
    .join(' ')
    .replace(/\bBhk\b/gi, 'BHK')
    .replace(/\b(\d+)\s*Bhk\b/gi, '$1BHK')
    .trim();
}
