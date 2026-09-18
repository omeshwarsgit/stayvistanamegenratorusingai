/**
 * html.js — small dependency-free helpers for pulling structured data and
 * readable text out of a fetched listing page.
 *
 * These are deliberately tolerant: OTA markup changes often, so every helper
 * returns "nothing found" rather than throwing, and callers treat a missing
 * field as unknown instead of guessing.
 */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-',
  mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  middot: '·', bull: '•', deg: '°', eacute: 'e', times: 'x', reg: '', copy: '',
};

export function decodeEntities(input = '') {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
    });
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Collapse whitespace and decode entities. */
export function clean(text = '') {
  return decodeEntities(String(text)).replace(/\s+/g, ' ').trim();
}

/** Strip scripts, styles and tags, leaving readable page text. */
export function toText(html = '') {
  return clean(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '. ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/** All `<script type="application/ld+json">` payloads that parse as JSON. */
export function extractJsonLd(html = '') {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const parsed = tryParseJson(m[1]);
    if (parsed) out.push(...flattenJsonLd(parsed));
  }
  return out;
}

function flattenJsonLd(node) {
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (node && typeof node === 'object') {
    const graph = node['@graph'];
    if (Array.isArray(graph)) return [node, ...graph.flatMap(flattenJsonLd)];
    return [node];
  }
  return [];
}

/** JSON payload of a `<script>` with a given id or attribute marker. */
export function extractScriptJson(html = '', matcher) {
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (!matcher.test(attrs)) continue;
    const parsed = tryParseJson(m[2]);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function tryParseJson(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  try {
    return JSON.parse(text);
  } catch {
    // Some pages wrap JSON in a JS assignment or trailing semicolon.
    const start = text.search(/[[{]/);
    if (start < 0) return null;
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Value of a `<meta>` tag by name or property. */
export function metaContent(html = '', key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return clean(m[1]);
  }
  return null;
}

export function pageTitle(html = '') {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(m[1]) : null;
}

/** First `<h1>` text, useful when a listing name is not in metadata. */
export function firstHeading(html = '') {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? clean(toText(m[1])) : null;
}

/**
 * Walk any parsed JSON and collect string values whose key matches `keyRe`.
 * OTA payloads bury the same field at wildly different paths between releases,
 * so searching by key name survives more redesigns than a fixed path does.
 */
export function collectStringsByKey(node, keyRe, limit = 400) {
  const found = [];
  const seen = new Set();
  const visit = (value) => {
    if (found.length >= limit || value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string' && keyRe.test(key) && val.trim()) {
        found.push(clean(val));
        if (found.length >= limit) return;
      } else if (val && typeof val === 'object') {
        visit(val);
      }
    }
  };
  visit(node);
  return found;
}

/** Deduplicate a list of strings case-insensitively, keeping first spelling. */
export function dedupeStrings(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item).toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).trim());
  }
  return out;
}
