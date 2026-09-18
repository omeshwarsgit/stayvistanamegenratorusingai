/**
 * usp.js — rank what actually makes this property attractive.
 *
 * A catalog weight is the generic strength of a feature. Ranking turns that
 * into a strength for *this* property: a pool table matters far more in a 6BHK
 * group villa than in a studio, a lawn matters less in an apartment, and a
 * feature the owner already put in the title is a feature guests respond to.
 */

export function rankUsps(facts) {
  const bedrooms = facts.bedrooms ? facts.bedrooms.value : null;
  const guests = facts.guests ? facts.guests.value : null;
  const type = facts.propertyType ? facts.propertyType.value : null;
  const fits = new Set(facts.guestFit || []);

  const ranked = facts.usps.map((usp) => {
    let strength = usp.weight;
    const reasons = [];

    if (!usp.titleWorthy) {
      strength = Math.min(strength, 30);
      reasons.push('Useful amenity, but guests expect it — weak in a title');
    }

    if (fits.has('group') && usp.tags.includes('group')) {
      strength += 6;
      reasons.push('Strong draw for the group bookings this size attracts');
    }
    if (fits.has('family') && usp.tags.includes('family')) {
      strength += 4;
      reasons.push('Matches the family audience for this property');
    }
    if (fits.has('couple') && usp.tags.includes('couple')) {
      strength += 5;
      reasons.push('Suits the couple/small-group audience');
    }
    if (fits.has('couple') && usp.tags.includes('group') && !usp.tags.includes('couple')) {
      strength -= 8;
      reasons.push('Group feature on a small property — less decisive');
    }
    if (usp.tags.includes('luxury') && !(facts.luxury && facts.luxury.value)) {
      strength -= 2;
    }

    if (type === 'Apartment' || type === 'Studio' || type === 'Room') {
      if (usp.category === 'lawn') {
        strength -= 12;
        reasons.push('Outdoor space reads as less central for this property type');
      }
      if (usp.category === 'view') {
        strength += 4;
        reasons.push('Views are the main differentiator for this property type');
      }
    }

    if (usp.source === 'listing-title') {
      strength += 5;
      reasons.push('Already in the current title — the owner sees it as the hook');
    }
    if (usp.mentions >= 3) {
      strength += 3;
      reasons.push(`Emphasised ${usp.mentions} times across the listing`);
    }
    if (usp.source === 'manual-added') {
      strength += 2;
      reasons.push('You added this feature, so it counts as verified');
    } else if (usp.source === 'manual') {
      reasons.push('From the listing details you provided');
    }
    if (usp.needsExplicit) {
      reasons.push('Listing states this explicitly, so the wording is safe to use');
    }

    if (bedrooms && bedrooms >= 6 && usp.category === 'games') {
      strength += 3;
      reasons.push('Large-group villas convert on entertainment');
    }
    if (guests && guests >= 12 && usp.category === 'lawn') {
      strength += 3;
      reasons.push('Big lawns matter when the property sleeps a crowd');
    }

    return {
      ...usp,
      strength: clamp(Math.round(strength), 0, 100),
      reasons: reasons.slice(0, 3),
    };
  });

  ranked.sort((a, b) => b.strength - a.strength || a.label.localeCompare(b.label));

  // Only features the listing states about itself can name it.
  const confirmed = ranked.filter((u) => u.confirmed !== false);
  const titleUsps = confirmed.filter((u) => u.titleWorthy && u.strength >= 45);
  const commodities = confirmed.filter((u) => !u.titleWorthy || u.strength < 45);
  const unconfirmed = ranked.filter((u) => u.confirmed === false && u.titleWorthy);

  return {
    ranked: confirmed,
    titleUsps,
    commodities,
    unconfirmed,
    /** Anything at all we could put in a title. */
    hasStrongUsp: titleUsps.length > 0 && titleUsps[0].strength >= 60,
  };
}

/**
 * Pairs that read naturally together in a title. Two mid-strength features can
 * beat one strong feature: "Pool & Games" says more than "Pool" alone.
 */
export function comboLabel(usps) {
  if (usps.length < 2) return null;
  const [a, b] = usps;
  const pairs = [
    [['fire', 'bbq'], 'BBQ & Bonfire'],
    [['bbq', 'fire'], 'BBQ & Bonfire'],
    [['pool', 'games'], 'Pool & Games'],
    [['pool', 'lawn'], 'Pool & Lawn'],
    [['pool', 'view'], null],
    [['games', 'fire'], 'Games & Bonfire'],
    [['lawn', 'bbq'], 'Lawn & BBQ'],
    [['games', 'entertainment'], 'Games & Theatre'],
  ];
  for (const [[first, second], label] of pairs) {
    if (a.category === first && b.category === second && label) return label;
  }
  const short = (u) => u.short || u.label;
  const combined = `${short(a)} & ${short(b)}`;
  return combined.length <= 20 ? combined : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
