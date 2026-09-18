/**
 * capture.js — read a listing from the browser the user is already using.
 *
 * Some OTAs only serve a listing inside their own site session: MakeMyTrip and
 * Goibibo answer a direct request with a byte-sized `200-OK` placeholder, to a
 * headless browser as much as to a script. Retrying that request, or rendering
 * it again, cannot produce a listing that was never in the response.
 *
 * What does work is the page the user can already see. They open the listing
 * normally, run a one-line snippet (bookmarklet or console paste), and the page
 * hands its own visible content to this local server. Nothing is bypassed: the
 * user navigates the site themselves, sees the content themselves, and chooses
 * to send it to their own tool. The dashboard is watching for it and analyses
 * the moment it lands.
 *
 * Captures live in memory only, for fifteen minutes, on the local machine.
 */

import crypto from 'node:crypto';

const TTL_MS = 15 * 60 * 1000;
const MAX_CAPTURES = 20;

/** Rotates every server start, so only this session's snippet is accepted. */
const TOKEN = crypto.randomBytes(12).toString('hex');

const captures = new Map();

export function captureToken() {
  return TOKEN;
}

export function saveCapture(payload = {}) {
  if (!payload || payload.token !== TOKEN) {
    return { ok: false, error: 'This capture snippet is from an older session. Reload the dashboard and copy it again.' };
  }
  const url = typeof payload.url === 'string' ? payload.url : '';
  const key = captureKey(url);
  if (!key) return { ok: false, error: 'The capture did not include the listing URL.' };

  const text = clip(payload.text, 200_000);
  const main = clip(payload.main, 120_000);
  if (!text && !main) return { ok: false, error: 'The page had no readable text to capture.' };

  prune();
  if (captures.size >= MAX_CAPTURES) {
    const oldest = [...captures.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) captures.delete(oldest[0]);
  }

  const record = {
    url,
    key,
    title: clip(payload.title, 400),
    text,
    main,
    jsonLd: Array.isArray(payload.ld) ? payload.ld.slice(0, 6).map((v) => clip(v, 80_000)).filter(Boolean) : [],
    meta: sanitiseMeta(payload.meta),
    at: Date.now(),
  };
  captures.set(key, record);
  return { ok: true, key, bytes: text.length + main.length };
}

/** Exact match on host+path, else the most recent capture inside the TTL. */
export function findCapture(url) {
  prune();
  const key = captureKey(url);
  if (key && captures.has(key)) return { ...captures.get(key), looseMatch: false };
  const newest = [...captures.values()].sort((a, b) => b.at - a.at)[0];
  return newest ? { ...newest, looseMatch: true } : null;
}

export function captureStatus(url) {
  const found = findCapture(url);
  if (!found) return { found: false };
  return {
    found: true,
    looseMatch: found.looseMatch,
    url: found.url,
    title: found.title,
    bytes: (found.text || '').length + (found.main || '').length,
    ageMs: Date.now() - found.at,
  };
}

export function clearCapture(url) {
  const key = captureKey(url);
  if (key) captures.delete(key);
}

/**
 * Turns a capture into the shape the parsers expect: the property's own section
 * is trusted, the rest of the visible page is not (an OTA page also lists other
 * properties), and any JSON-LD or og tags are rebuilt into a small document the
 * HTML parser can read.
 */
export function captureToHtml(record) {
  if (!record) return '';
  const parts = ['<!doctype html><html><head>'];
  if (record.title) parts.push(`<title>${escapeHtml(record.title)}</title>`);
  for (const [key, value] of Object.entries(record.meta || {})) {
    parts.push(`<meta property="${escapeHtml(key)}" content="${escapeHtml(value)}" />`);
  }
  for (const block of record.jsonLd || []) {
    parts.push(`<script type="application/ld+json">${block.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  parts.push('</head><body>');
  if (record.main) parts.push(`<main>${escapeHtml(record.main)}</main>`);
  if (record.text) parts.push(`<div id="rest-of-page">${escapeHtml(record.text)}</div>`);
  parts.push('</body></html>');
  return parts.join('\n');
}

/**
 * Where a listing page stops describing itself and starts advertising others.
 * Everything from here on is page content, not this property.
 */
const OTHER_PROPERTIES = /\b(?:similar\s+(?:properties|hotels|villas|stays)|you\s+may\s+(?:also\s+)?like|other\s+(?:properties|options)|recommended\s+for\s+you|nearby\s+(?:properties|hotels)|people\s+also\s+viewed|popular\s+filters|explore\s+more|top\s+rated\s+(?:properties|hotels)|handpicked\s+for\s+you)\b/i;

/** Headings that end an amenity list. */
const SECTION_END = /^(?:location|about|policies|policy|house\s+rules|reviews?|rating|similar|popular|things\s+to\s+do|nearby|faq|cancellation|price|rooms?|select\s+)/i;

const AMENITY_HEADING = /^(?:amenities|amenity|facilities|features|what\s+this\s+place\s+offers|property\s+amenities|popular\s+(?:amenities|facilities))\s*:?\s*$/i;

/**
 * The part of a captured page that is about this property: its own section, cut
 * at the point the page starts listing other properties, and capped — property
 * copy leads, carousels and filter lists follow.
 */
export function trustedSection(record) {
  const source = (record && (record.main || record.text)) || '';
  const cut = source.search(OTHER_PROPERTIES);
  const own = cut > 200 ? source.slice(0, cut) : source;
  return own.slice(0, 3000).trim();
}

/**
 * Amenity lines listed under an "Amenities" style heading. Short lines under
 * such a heading are the page's own amenity list, which is worth having as a
 * labelled list rather than as loose text.
 */
export function amenityLines(record) {
  const source = (record && (record.main || record.text)) || '';
  const lines = source.split(/\r?\n/).map((l) => l.trim());
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (AMENITY_HEADING.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (!line) {
      if (out.length) break;
      continue;
    }
    if (SECTION_END.test(line) || OTHER_PROPERTIES.test(line)) break;
    if (line.length > 60 || /[.!?]$/.test(line)) break;
    out.push(line);
    if (out.length >= 60) break;
  }
  return out;
}

/* --------------------------------------------------------- the snippet ---- */

/**
 * The capture snippet, as one expression. Served both as a bookmarklet href and
 * as a console paste, because a bookmarklet needs a bookmarks bar and a console
 * paste does not.
 */
export function snippetSource(origin) {
  return `(function(){
  var pick=function(sels){for(var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);if(el&&el.innerText&&el.innerText.length>400)return el.innerText;}return '';};
  var cap={
    token:'${TOKEN}',
    url:location.href,
    title:document.title,
    text:(document.body?document.body.innerText:'').slice(0,150000),
    main:pick(['main','[role=main]','article','#detailPage','#detail','.detailPage','#content','.property-detail','[data-testid="property-section"]','[class*="detail"]']).slice(0,80000),
    ld:[].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){return (s.textContent||'').slice(0,60000);}).slice(0,6),
    meta:(function(){var o={};[].slice.call(document.querySelectorAll('meta[property],meta[name]')).forEach(function(m){var k=m.getAttribute('property')||m.getAttribute('name')||'';if(/^(og:|twitter:|description$|place:)/i.test(k))o[k]=m.getAttribute('content')||'';});return o;})()
  };
  var body=JSON.stringify(cap);
  var toast=function(msg,bad){var d=document.createElement('div');d.textContent=msg;d.style.cssText='position:fixed;z-index:2147483647;left:50%;top:24px;transform:translateX(-50%);padding:12px 18px;border-radius:10px;font:600 14px/1.4 system-ui,sans-serif;color:#1e1e1e;background:'+(bad?'#e9a0a7':'#cfe0cd')+';box-shadow:0 6px 24px rgba(0,0,0,.18)';document.body.appendChild(d);setTimeout(function(){d.remove();},4000);};
  var viaTab=function(){try{window.open('${origin}/capture/receive#'+encodeURIComponent(body),'_blank');}catch(e){toast('Capture failed: '+e.message,1);}};
  try{
    fetch('${origin}/api/capture',{method:'POST',headers:{'Content-Type':'text/plain'},body:body,mode:'cors'})
      .then(function(r){return r.ok?r.json():Promise.reject(new Error('rejected'));})
      .then(function(){toast('Listing captured - go back to the OTA Name Generator');})
      .catch(viaTab);
  }catch(e){viaTab();}
})();`;
}

export function bookmarkletHref(origin) {
  return `javascript:${encodeURIComponent(snippetSource(origin).replace(/\s*\n\s*/g, ''))}`;
}

/** The page the snippet opens when the site's CSP blocks a direct POST. */
export function receivePageHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Capturing listing...</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#faf7f2;color:#1e1e1e;margin:0;display:grid;place-items:center;height:100vh}
.box{background:#fff;border:1px solid #e6dfd4;border-radius:14px;padding:28px 32px;max-width:34rem;text-align:center;box-shadow:0 4px 16px rgba(30,30,30,.07)}
h1{font:400 22px/1.2 Georgia,serif;margin:0 0 8px}p{margin:6px 0;color:#57534e}</style></head>
<body><div class="box"><h1 id="head">Capturing the listing...</h1>
<p id="msg">Sending the page you were viewing to your local dashboard.</p></div>
<script>
(async function(){
  var head=document.getElementById('head'), msg=document.getElementById('msg');
  var raw=location.hash.slice(1);
  if(!raw){head.textContent='Nothing to capture';msg.textContent='Open the listing, then run the capture snippet there.';return;}
  try{
    var res=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':'text/plain'},body:decodeURIComponent(raw)});
    var data=await res.json();
    if(!data.ok) throw new Error(data.error||'the capture was rejected');
    head.textContent='Listing captured';
    msg.textContent='Go back to the OTA Property Name Generator - it is already analysing.';
    setTimeout(function(){window.close();},1800);
  }catch(err){
    head.textContent='Capture failed';
    msg.textContent=err.message;
  }
})();
</script></body></html>`;
}

/* ---------------------------------------------------------------- helpers */

export function captureKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, record] of captures) {
    if (record.at < cutoff) captures.delete(key);
  }
}

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function sanitiseMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  for (const [key, value] of Object.entries(meta)) {
    if (!/^(?:og:|twitter:|place:|description$)/i.test(key)) continue;
    if (typeof value !== 'string') continue;
    out[key.slice(0, 60)] = value.slice(0, 1000);
  }
  return out;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
