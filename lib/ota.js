/**
 * ota.js — which OTA is this URL, and is it safe to fetch?
 */

export const OTAS = {
  /** Not an OTA — the source of truth this tool reads from. */
  stayvista: { id: 'stayvista', label: 'StayVista', source: true, hosts: [/(^|\.)stayvista\.com$/i, /(^|\.)vistarooms\.com$/i] },
  airbnb: { id: 'airbnb', label: 'Airbnb', hosts: [/(^|\.)airbnb\.[a-z.]+$/i, /(^|\.)abnb\.me$/i] },
  booking: { id: 'booking', label: 'Booking.com', hosts: [/(^|\.)booking\.com$/i] },
  makemytrip: { id: 'makemytrip', label: 'MakeMyTrip', hosts: [/(^|\.)makemytrip\.com$/i, /(^|\.)makemytrip\.ae$/i] },
  agoda: { id: 'agoda', label: 'Agoda', hosts: [/(^|\.)agoda\.com$/i, /(^|\.)agoda\.net$/i] },
  goibibo: { id: 'goibibo', label: 'Goibibo', hosts: [/(^|\.)goibibo\.com$/i] },
};

const PRIVATE_HOST = [
  /^localhost$/i, /^127\./, /^0\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./, /^\[?::1\]?$/, /^\[?fc00:/i, /^\[?fe80:/i,
  /\.local$/i, /\.internal$/i,
];

/** Accepts bare hostnames ("airbnb.co.in/rooms/1") by assuming https. */
export function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/^[<(]|[>)]$/g, '');
  if (!trimmed) return { ok: false, error: 'Please paste a property listing URL.' };

  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }
  if (PRIVATE_HOST.some((re) => re.test(url.hostname))) {
    return { ok: false, error: 'Local and private-network addresses are not allowed.' };
  }
  return { ok: true, url: url.toString(), host: url.hostname };
}

export function detectOta(urlString) {
  let host = '';
  try {
    host = new URL(urlString).hostname;
  } catch {
    return { id: 'unknown', label: 'Unknown OTA', supported: false };
  }
  for (const ota of Object.values(OTAS)) {
    if (ota.hosts.some((re) => re.test(host))) return { ...ota, supported: true };
  }
  
  return { id: 'unknown', label: prettyHost(host), supported: false };
}

function prettyHost(host) {
  const base = String(host).replace(/^www\./i, '').split('.')[0] || 'Unknown';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Airbnb room id / Booking hotel slug etc., handy for display and caching. */
export function listingId(urlString, otaId) {
  try {
    const url = new URL(urlString);
    if (otaId === 'stayvista') {
      const m = url.pathname.match(/\/villas?\/([^/?#]+)/i);
      return m ? m[1] : null;
    }
    if (otaId === 'airbnb') {
      const m = url.pathname.match(/\/rooms\/(?:plus\/)?(\d+)/);
      return m ? m[1] : null;
    }
    if (otaId === 'booking') {
      const m = url.pathname.match(/\/hotel\/[a-z]{2}\/([^/.]+)/i);
      return m ? m[1] : null;
    }
    return url.pathname.split('/').filter(Boolean).pop() || null;
  } catch {
    return null;
  }
}
