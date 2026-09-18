/**
 * fetcher.js — fetch one public listing page.
 *
 * Deliberately simple and polite: a single request with ordinary browser
 * headers, a timeout, and a size cap. It makes no attempt to defeat bot
 * protection, CAPTCHAs or login walls — when a page is gated the tool says so
 * and asks the user to paste the listing details instead.
 */

const MAX_BYTES = 3_500_000;
const TIMEOUT_MS = 20_000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

const CHALLENGE_MARKERS = [
  /awsWafCookieDomainList|aws-waf-token|awswaf/i,
  /_px[A-Za-z]*Captcha|perimeterx|datadome|distil_r_captcha/i,
  /are you a (?:robot|human)/i,
  /unusual traffic/i,
  /verify you are (?:a )?human/i,
  /access (?:to this page has been )?denied/i,
  /px-captcha|_Incapsula_|cf-browser-verification|cf_chl_opt/i,
  /just a moment\s*(?:\.\.\.|…)/i,
  /enable javascript and cookies to continue/i,
  /request blocked/i,
];

const LOGIN_MARKERS = [/sign in to (?:continue|view)/i, /log in to (?:continue|view)/i];

export async function fetchListing(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url || url,
        contentType,
        reason: res.status === 403 || res.status === 429 ? 'blocked' : 'http-error',
        message: describeStatus(res.status),
      };
    }

    // A JSON reply is not a failure — several OTAs answer a listing URL with an
    // API payload, and the property is in there. Only genuinely unreadable
    // binary responses are rejected here.
    const kind = classify(contentType);
    if (kind === 'binary') {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url || url,
        contentType,
        reason: 'not-a-page',
        message: `The URL returned ${contentType || 'binary content'}, which cannot contain a listing. Check that the URL points at a property page.`,
      };
    }

    const html = await readCapped(res);
    if (CHALLENGE_MARKERS.some((re) => re.test(html.slice(0, 20000)))) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url || url,
        reason: 'blocked',
        message: 'The OTA served a bot-protection challenge instead of the listing.',
      };
    }
    if (html.length < 1200 && LOGIN_MARKERS.some((re) => re.test(html))) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url || url,
        reason: 'login-required',
        message: 'This listing is behind a login wall.',
      };
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      contentType,
      kind,
      html,
      bytes: html.length,
    };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: null,
      reason: aborted ? 'timeout' : 'network',
      message: aborted
        ? 'The listing page took too long to respond.'
        : `Could not reach the listing (${err && err.message ? err.message : 'network error'}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** html | json | text for anything readable; binary for the rest. */
function classify(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (/application\/(?:json|.*\+json)|text\/json/.test(type)) return 'json';
  if (/text\/html|application\/xhtml/.test(type)) return 'html';
  if (/^$|text\/|application\/(?:xml|javascript|x-javascript)/.test(type)) return 'text';
  return 'binary';
}

async function readCapped(res) {
  if (!res.body || typeof res.body.getReader !== 'function') return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      break;
    }
  }
  out += decoder.decode();
  return out;
}

function describeStatus(status) {
  if (status === 403) return 'The OTA refused the request (403). The listing is likely bot-protected.';
  if (status === 404) return 'The listing was not found (404). The URL may be wrong or the property removed.';
  if (status === 410) return 'The listing has been removed (410).';
  if (status === 429) return 'The OTA rate-limited the request (429). Try again in a few minutes.';
  if (status >= 500) return `The OTA returned a server error (${status}).`;
  return `The OTA returned HTTP ${status}.`;
}
