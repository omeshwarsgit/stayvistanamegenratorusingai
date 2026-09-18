# 🏗 Architecture — ota-name-generator

## Shape

A local Node.js app: a zero-dependency `node:http` server that serves a static dashboard and one
JSON endpoint. All the product logic is in `lib/`, pure and synchronous apart from the fetch and
the optional Claude call, which makes it directly testable without a browser or a network.

```
browser (public/)  ──POST /api/analyze──▶  lib/analyze.js
                                              │
        ota.js ── detect OTA, guard the URL ◀──┤
     fetcher.js ── one polite request ─────────┤
 parsers/index.js ── page → raw signals ───────┤
       facts.js ── signals → FACT SHEET ───────┤   (source + evidence per fact)
         usp.js ── rank USPs for THIS property ┤
       names.js ── build title candidates ─────┤
        llm.js  ── optional Claude proposals ──┤
    validate.js ── accuracy gate + guidelines ─┤   (rejects, never rewrites)
       score.js ── 100-point score + reasons ──┘
                                              │
                              recommendation + alternatives
```

## The one invariant

**Nothing reaches a name that is not on the fact sheet.**

Every fact is `{ value, source, evidence }` where `source` is one of `json-ld`, `embedded`,
`meta`, `page-text`, `listing-title`, `amenity-list`, `manual` (pasted by the user) or
`manual-added` (a USP the user explicitly added). A field that cannot be found stays `null`.

`validate.js` builds an allowed vocabulary from the fact sheet — brand, location, property type,
verified USP labels and their short forms, size numbers per unit, plus a small neutral word list —
and rejects any candidate containing a word outside it. Qualifier words (`GATED_WORDS`: private,
infinity, heated, panoramic, beachfront, hilltop, luxury, …) unlock only when a USP whose label
owns that word actually fired. This gate runs identically on engine output and on Claude output,
which is what makes the AI pass safe to enable.

## Key data structures

**USP catalog entry** (`lib/knowledge.js`) — the product's domain opinion:

```js
{
  id: 'private_pool', label: 'Private Pool', short: 'Pool',
  category: 'pool',        // at most one per TITLE
  feature: 'pool',         // de-duplicates alternative wordings of the SAME fact
  weight: 96,              // title strength for an OTA guest, not how nice it is
  needsExplicit: true,     // label adds a qualifier → only fires if the listing says it
  titleWorthy: true,       // false = commodity (Wi-Fi, parking): shown, never in a title
  match: [/…/i], tags: ['group', 'family', 'luxury', 'experience'],
}
```

`weight` is the generic strength; `usp.js` turns it into a per-property `strength` using bedroom
count, derived guest fit (group/family/couple/work), property type (a lawn matters less in an
apartment, views more), whether the owner already put it in the current title, and how often the
listing repeats it. Each adjustment records a human-readable reason, which is what the dashboard's
USP Priority list shows.

**Title candidate** (`lib/names.js`) — prioritised segments, joined with `•`:

```js
[{ text: '6BHK Hilltop Villa', priority: 10 },
 { text: 'Private Pool',       priority: 9 },
 { text: 'Karjat',             priority: 8 }]
```

Fitting to the limit is a ladder: safe substitutions (`Swimming Pool → Pool`, `Bedrooms → BHK`,
`and → &`), then USP short forms, then dropping the lowest-priority segment. Nothing is truncated
mid-word, and the UI reports what was shortened or dropped.

## Extraction strategy

OTA markup changes constantly, so the parser never depends on a fixed path:

1. **JSON-LD** — the OTA's own structured data (strongest).
2. **Embedded app state** — `data-deferred-state` / `__NEXT_DATA__` / capla blobs, mined **by key
   name** (`propertyType`, `personCapacity`, `AmenityItem.title`, …) rather than by path, so a
   redesign degrades instead of breaking.
3. **Meta tags** — `og:title` / `og:description`, which OTAs keep accurate for sharing and which
   usually carry the layout line ("12 guests · 6 bedrooms · 8 beds").
4. **Page text** — last resort, marked as the weakest source in the UI so the user can check it.

Counts are taken in that order of precedence, each with the quote that proved it.

## Failure handling

Every stage fails softly and visibly:

- URL invalid / private address → refused before any request (`ota.js`).
- Bot challenge, login wall, 4xx/5xx, timeout, non-HTML → `fetch` failure with a specific message.
- Page fetched but nothing readable (JS-rendered) → reported as `reason: 'js-rendered'` with an
  explanation and the paste path, rather than an empty analysis.
- Some fields missing → "Partial listing information available", listing exactly what was not
  found; names use only what was verified.

The paste path routes a full HTML paste through the same `parseListing` pipeline and prose through
`parseText`, so pasting page source yields the same structured extraction as a direct fetch.

## Security notes

- **SSRF:** only http/https, and localhost/private/link-local hosts are refused.
- **XSS:** all listing-derived content is rendered through `esc()` in `public/app.js`.
- **Request limits:** 200 KB request body, 3.5 MB response cap, 20 s timeout, one request per
  analysis.
- **Data out:** the Claude pass sends only the verified fact sheet, never the fetched page.
