/**
 * otastyle.js — one title per OTA, written the way that OTA reads.
 *
 * The same property wants different titles on different platforms, because the
 * audience and the surrounding UI differ:
 *
 *  - **Airbnb** shows the location under every card and truncates long titles,
 *    so the city is wasted characters and short, natural phrasing wins.
 *  - **Booking.com** treats the title as the property's *name* and shows the
 *    town separately, so the house name leads and keyword stacking is out of
 *    place.
 *  - **MakeMyTrip** and **Goibibo** serve a domestic audience that searches
 *    "4BHK villa in Lonavala with private pool" — BHK terminology and the city
 *    both belong in the title.
 *  - **Agoda** skews international, where "BHK" is not read as a room count, so
 *    the bedroom count is spelled out.
 *
 * These are naming conventions drawn from how listings on each platform read,
 * not quoted policy — treat them as sensible defaults and adjust per platform
 * if your account manager advises otherwise.
 *
 * Accuracy is unchanged: every candidate here goes through the same gate as the
 * main engine, so nothing gets claimed that the property page did not confirm.
 */

import { SHORTENINGS } from './knowledge.js';

export const OTA_PROFILES = [
  {
    id: 'airbnb',
    label: 'Airbnb',
    glyph: 'house',
    accent: 'bloom',
    audience: 'Experience-led guests; the card already shows the location',
    convention: 'Short and natural, no separators, no city — Airbnb truncates long titles',
    maxChars: 44,
    includeCity: false,
    allowAbbrev: false,
  },
  {
    id: 'booking',
    label: 'Booking.com',
    glyph: 'bed',
    accent: 'sky',
    audience: 'Mixed domestic and international; town shown beside the name',
    convention: 'The house name leads — Booking treats the title as the property name',
    maxChars: 50,
    includeCity: false,
    allowAbbrev: false,
  },
  {
    id: 'makemytrip',
    label: 'MakeMyTrip',
    glyph: 'plane',
    accent: 'shine',
    audience: 'Indian domestic, searching "4BHK villa in <city> with private pool"',
    convention: 'BHK first, city at the end, feature words spelled the way guests search',
    maxChars: 50,
    includeCity: true,
    allowAbbrev: true,
  },
  {
    id: 'agoda',
    label: 'Agoda',
    glyph: 'globe',
    accent: 'sage',
    audience: 'International and pan-Asian travellers',
    convention: 'Bedroom count spelled out (BHK does not travel), name and city included',
    maxChars: 50,
    includeCity: true,
    allowAbbrev: false,
    spellOutBedrooms: true,
  },
  {
    id: 'goibibo',
    label: 'Goibibo',
    glyph: 'home',
    accent: 'skyDeep',
    audience: 'Indian domestic, group and family bookings',
    convention: 'BHK and city, with the feature pair or capacity that groups compare on',
    maxChars: 50,
    includeCity: true,
    allowAbbrev: true,
  },
];

/**
 * Builds the candidate titles for one OTA, best first. The caller validates and
 * scores them, so this only has to produce accurate, well-formed strings.
 */
export function candidatesFor(profile, slots) {
  const { size, sizeWords, type, brand, loc, usp1, usp2, modifier, guests } = slots;
  const sizeToken = profile.spellOutBedrooms ? sizeWords : size;
  const city = profile.includeCity ? loc : null;
  const out = [];

  const withCity = (text) => (city ? `${text}, ${city}` : text);
  const uspText = (usp) => (usp ? usp.label : null);

  // Airbnb strictly excludes brand names (focusing on experience, BHK, and top USPs)
  if (profile.id === 'airbnb') {
    if (modifier && usp1 && type && modifier !== usp1) {
      out.push(`${[modifier.label, sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`);
    }
    if (usp1 && usp2 && type) out.push(`${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)} & ${usp2.label}`);
    if (usp1 && type) out.push(`${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`);
    if (type) out.push(`${[sizeToken, type].filter(Boolean).join(' ')}`);
  }

  // Booking.com leads with house name if available, or StayVista brand
  if (profile.id === 'booking') {
    const isBrandSv = brand && /stayvista|vista/i.test(brand);
    const houseName = isBrandSv ? null : brand;
    if (houseName) {
      if (usp1) out.push(`${houseName} by StayVista - ${sizeToken} w/ ${usp1.short || usp1.label}`);
      out.push(`${houseName} by StayVista - ${[sizeToken, type].filter(Boolean).join(' ')}`);
      if (usp1 && type) out.push(`${houseName} by StayVista - ${[sizeToken, usp1.short || usp1.label, type].filter(Boolean).join(' ')}`);
    }
    if (usp1 && type) {
      out.push(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`);
      out.push(`StayVista | ${[sizeToken, usp1.label, type].filter(Boolean).join(' ')}`);
    }
    if (type) out.push(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')}`);
    if (usp1 && type) out.push(withCity(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`));
    out.push(`StayVista - ${sizeToken || 'Villa'}`);
  }

  // MakeMyTrip domestic formula with StayVista brand, BHK, and City
  if (profile.id === 'makemytrip') {
    if (usp1 && type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')} with ${usp1.short || uspText(usp1)}`));
    if (usp1 && usp2 && type) out.push(withCity(`StayVista | ${[sizeToken, usp1.short || usp1.label, type].filter(Boolean).join(' ')} | ${usp2.short || usp2.label}`));
    if (usp1 && type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`));
    if (type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')}`));
    out.push(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')}`);
  }

  // Agoda with StayVista brand, spelled-out bedrooms, name & city
  if (profile.id === 'agoda') {
    if (usp1 && type) out.push(withCity(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')} w/ ${usp1.short || uspText(usp1)}`));
    if (type) out.push(withCity(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')}`));
    if (usp1 && type) out.push(withCity(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')} with ${uspText(usp1)}`));
    out.push(`StayVista - ${[sizeToken, type].filter(Boolean).join(' ')}`);
  }

  // Goibibo with StayVista brand, BHK, feature pair & city
  if (profile.id === 'goibibo') {
    if (usp1 && type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')} with ${usp1.short || uspText(usp1)}`));
    if (usp1 && usp2 && type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')} | ${usp1.short || usp1.label} & ${usp2.short || usp2.label}`));
    if (type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')}`));
    if (guests && usp1 && type) out.push(withCity(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')} for ${guests} | ${uspText(usp1)}`));
    out.push(`StayVista | ${[sizeToken, type].filter(Boolean).join(' ')}`);
  }

  return out.map(tidy).filter(Boolean);
}

/**
 * Brings a candidate under the OTA's limit without losing its lead feature:
 * approved abbreviations first (only where that OTA's audience reads them),
 * then the trailing city, then a second feature.
 */
export function fitForProfile(name, profile) {
  const limit = profile.maxChars;
  if (name.length <= limit) return { name, trimmed: [] };
  const trimmed = [];
  let current = name;

  if (profile.allowAbbrev) {
    for (const [pattern, replacement] of SHORTENINGS) {
      if (current.length <= limit) break;
      const next = current.replace(pattern, replacement);
      if (next !== current) {
        trimmed.push(`shortened to "${replacement}"`);
        current = next;
      }
    }
  }

  if (current.length > limit && /, [^,]+$/.test(current)) {
    current = current.replace(/, [^,]+$/, '');
    trimmed.push('dropped the city');
  }
  if (current.length > limit && / \| [^|]+$/.test(current)) {
    current = current.replace(/ \| [^|]+$/, '');
    trimmed.push('dropped the second feature');
  }
  if (current.length > limit && / & [^&]+$/.test(current)) {
    current = current.replace(/ & [^&]+$/, '');
    trimmed.push('dropped the second feature');
  }

  current = tidy(current);
  return current.length <= limit ? { name: current, trimmed } : null;
}

function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,|])/g, '$1')
    .replace(/([,|])\s*$/, '')
    .replace(/\s*\|\s*/g, ' | ')
    .trim();
}

/** Why this wording suits this platform, in one line. */
export function rationaleFor(profile, name, slots) {
  const bits = [];
  if (profile.id !== 'airbnb' && /stayvista/i.test(name)) {
    bits.push('includes StayVista brand identity for verified trust');
  }
  if (profile.id === 'airbnb' && !/stayvista/i.test(name)) {
    bits.push('excludes brand name to comply with Airbnb guidelines and maximize USP character budget');
  }
  if (!profile.includeCity && slots.loc && !name.toLowerCase().includes(slots.loc.toLowerCase())) {
    bits.push(`leaves the city out — ${profile.label} already shows it, so the characters go to the property`);
  }
  if (profile.spellOutBedrooms && slots.sizeWords && name.includes(slots.sizeWords)) {
    bits.push('spells out the bedroom count for an international audience');
  }
  if (profile.id === 'booking' && slots.brand && name.startsWith(slots.brand)) {
    bits.push('leads with the house name, which is what Booking.com treats the title as');
  }
  if (profile.includeCity && slots.loc && name.toLowerCase().includes(slots.loc.toLowerCase())) {
    bits.push(`keeps ${slots.loc} in the title, where this audience searches by city`);
  }
  if (profile.id === 'airbnb' && !name.includes('|')) {
    bits.push('reads as one natural phrase rather than stacked keywords');
  }
  if (!bits.length) bits.push(`fits ${profile.label} conventions`);
  return `${bits.join('; ')}.`;
}
