# OTA Property Name Generator

A single-property tool. Paste **one** OTA listing URL; it reads the publicly available
listing, builds a fact sheet of what it can actually verify, ranks what genuinely sells
the property, then writes, checks, scores and recommends OTA-ready names.

No Excel upload, no bulk processing, no batch generation — one property at a time, by design.

```bash
npm start
```

Then open <http://localhost:5178>.

Node 20+ is required. The tool runs with **zero runtime dependencies**; `npm install` is only
needed if you want the optional Claude pass (see [Modes](#modes)).

---

## What it does

```
read the listing → verified fact sheet → rank the USPs → understand the guest →
generate names → check accuracy → check the character limit → score → recommend one
```

Supported OTAs, auto-detected from the URL: **Airbnb, Booking.com, MakeMyTrip, Agoda,
Goibibo**. Any other host still works through generic extraction, flagged as unrecognised.

### The dashboard

| Section | What it shows |
|---|---|
| Property Analysis | Name, OTA, type, location, bedrooms, guests, bathrooms, rating — each tagged with **where it came from**; hover a tag for the exact evidence |
| Key Property USPs | Every confirmed feature, plus commodity amenities and anything seen on the page but *not* confirmed for this property (one click confirms it) |
| USP Priority | Features ranked by how strongly each would sell *this* property in a title, with the reason for each ranking |
| AI Recommended Name | One recommended name, character count, score out of 100, "Why this name?", full score breakdown, Copy button |
| Other Name Suggestions | 10–15 alternatives, each with character count, score and the naming approach used |
| Property Information | Correct any extracted field, add a USP, exclude a USP, change the character limit, regenerate |

---

## How a listing is read

A JSON response is **not** a failure — several OTAs answer a listing URL with an API payload, and
the property is in there under key names rather than markup. Seven routes are tried in order, and
their results are merged, so a name from the URL and a layout from a browser capture end up on the
same fact sheet:

| # | Route | What it reads |
|---|---|---|
| 0 | Browser capture | a listing your own browser has already displayed (see below) |
| 1 | HTML response | JSON-LD, `og:`/meta tags, page text |
| 2 | JSON response | the API payload, mined by key name (`propertyName`, `maxGuests`, `amenityName`, …) |
| 3 | Embedded JSON | `data-deferred-state`, `__NEXT_DATA__`, capla payloads, Redux/app state |
| 4 | OTA-specific pass | the adapter's own script selectors, plus every sizeable embedded blob pushed through the JSON parser |
| 5 | Browser rendering | runs the page's own client-side app in local headless Chrome or Edge |
| 6 | URL metadata | the property name, city, type and BHK encoded in the listing path |

The chain stops as soon as it has enough fields, and it never repeats a request that has already
proved pointless: an OTA that answers with a byte-sized placeholder gets one attempt, and the same
URL is not fetched or rendered again in that session. The dashboard shows exactly which routes ran,
what each returned, and which one produced the data. The same trace is printed to the server
console (silence it with `OTA_LOG=0`):

```
[analyze] https://www.agoda.com/…/hotel/…
  OTA detected: Agoda
  Response type: text/html; charset=utf-8 (HTTP 200, 288 KB)
  Direct fetch: SUCCESS · html response
  HTML extraction: FAILED · markup held no listing fields
  Embedded JSON extraction: FAILED · no embedded app state in the page
  OTA-specific extraction: FAILED · no OTA-specific payload found in the page
  Browser rendering: SUCCESS · 5 fields · chrome.exe, 1005 KB rendered
  Fields extracted: 5
```

Logs record what happened, never what was sent: no headers, cookies or tokens, and URLs are
logged without their query string so booking and session parameters cannot leak into a log file.

### Capture from my browser

MakeMyTrip and Goibibo only serve a listing inside their own site session: a direct request gets a
six-byte `200-OK` placeholder, and so does a real headless browser. There is no listing in the
response to parse, so retrying or rendering it again cannot work.

The page you are looking at, however, is readable. When a listing cannot be fetched, the dashboard
offers **Capture from my browser**:

1. **Open listing in my browser** hands the URL to your default browser.
2. Run the capture snippet on that page — drag the blue chip to your bookmarks bar once and click
   it on any listing, or use **Copy console snippet**, press F12 and paste it into the Console.
3. Come back. The panel is polling, and analyses the moment the capture lands.

The snippet sends the page's visible text, its main property section, its JSON-LD and its `og:`
tags to `http://127.0.0.1:5178`. Nothing is bypassed: you navigate the site yourself, you see the
content yourself, and you choose to hand it to your own tool. Captures are held in memory on your
machine for fifteen minutes, and only this server session's token is accepted.

The property's own section is treated as the listing describing itself — cut at the point the page
starts advertising other properties — so a neighbouring villa's infinity pool stays out of your
title. For the MakeMyTrip example above, a capture produces
`4BHK Hilltop Villa • Private Pool • Lonavala`, 44/50 characters, scored 98/100, with 13 ranked
USPs.

### Even without a capture, the URL is not wasted

Every OTA encodes the property name and usually the city in the listing path
(`/hotels/stayvista_mehta_mansion_villa-details-lonavala.html`). That is public, checkable
information, so it seeds the fact sheet: you get an immediate partial analysis and a usable name
rather than an error screen, with the capture panel alongside it to fill in the rest.

### Browser rendering, and the line it will not cross

Rendering uses whatever Chrome or Edge is already installed, driven over the DevTools protocol
(no Puppeteer, no browser download — Node's built-in WebSocket speaks CDP directly). One page at
a time, a temporary profile, and the browser shuts down after a minute idle.

Its purpose is to execute a page's own client-side app, which is the only way to read content
that is otherwise public. It stops at gates: if the rendered page turns out to be a
bot-protection challenge, a CAPTCHA or a login wall, it reports `blocked` and goes no further. It
never waits for a challenge to clear, solves one, or replays session cookies.

- `OTA_RENDER=0` switches rendering off entirely.
- `OTA_CHROME_PATH` points at a specific browser binary.

### What each OTA actually returns

Measured against live listing URLs, last checked 10 September 2026:

| OTA | Result |
|---|---|
| **Airbnb** | Works from the URL alone. Full extraction: name, type, location, layout, 57 amenities, rating |
| **Agoda** | Empty shell served to any client; **rendering reads it**, taking about 10–20 seconds |
| **Booking.com** | Answers automated requests with an AWS WAF bot challenge. Not satisfied by design → paste path |
| **MakeMyTrip** | Answers with a six-byte `200-OK` placeholder — `Content-Type: application/json`, no listing data in it. A real rendering browser gets the same placeholder, so the URL is not retried → **Capture from my browser**, or paste |
| **Goibibo** | Same as MakeMyTrip (same group): an eight-byte `200 - OK` placeholder → **Capture from my browser**, or paste |

When a listing genuinely cannot be read, the dashboard says which routes were tried and what each
one returned, offers **Capture from my browser**, and keeps the paste box as a manual alternative —
which accepts either:

- **the visible page text** — select all on the listing in your browser and copy; or
- **the page source** — `Ctrl+U`, `Ctrl+A`, `Ctrl+C` — which gives the same full structured
  extraction as a direct fetch when the OTA embeds its data in the page.

Facts from a paste are marked *From your details*, and the URL you entered is still used to detect
the OTA. Analysis quality is the same; only the delivery of the page differs. For the MakeMyTrip
example above, pasting the listing details produces
`4BHK Hilltop Villa • Private Pool • Lonavala` — 44/50 characters, scored 98/100.

---

## The rules it enforces

**Accuracy.** A name may only use facts on the fact sheet. Every candidate — engine-written or
Claude-written — passes through a vocabulary gate before it can be shown: each meaningful word
must trace back to a verified fact, and qualifier words (`Private`, `Infinity`, `Heated`,
`Panoramic`, `Beachfront`, `Hilltop`, `Luxury`…) only unlock when the listing states them.

- Listing says `Swimming pool` → the tool writes **Pool**, never *Private Pool*.
- Listing says `Mountain view` → **Mountain View**, never *Panoramic Mountain View*.
- A 6-bedroom property can never be titled `8BHK`, even if it has 8 beds.

**Whose feature is it?** A listing page talks about more than the listing: neighbouring
properties, filter labels, amenity glossaries and area guides all read alike. So the page is split
into two zones. The **trusted zone** is what the listing says about itself — its title, its
description, its amenity list, and anything you paste or add. The **page zone** is everything
else. Features found only in the page zone are shown to you but never used in a name, and one
click promotes one to a fact.

Proximity language is treated the same way: a property *ten minutes from the beach* is not
beachfront, and an area guide mentioning *a restored 18th-century farmhouse nearby* does not make
the property a farmhouse. Distance wording invalidates a setting claim — but not an amenity claim,
since a pool mentioned in the same sentence as a landmark is still the property's pool. A guest
count read off the page body (often a function-room capacity) informs the analysis but cannot
enter a title.

Candidates that break any of this are discarded, and the dashboard lists them under
"candidates discarded by the accuracy check" so nothing fails silently.

**Character limit.** Default 50, configurable. A name over the limit is shortened first by safe
substitutions (`Swimming Pool → Pool`, `Bedrooms → BHK`, `and → &`), then by dropping its
lowest-priority segment — the strongest USP, the size and the location go last. Nothing is ever
truncated mid-word, and no name shown can exceed the limit; the tests check every limit from 20 to
120 characters.

**OTA guidelines.** Phone numbers, URLs, prices, discounts, urgency, ALL-CAPS, emoji, decorative
punctuation, repeated words and unsupported superlatives are all rejected.

---

## Modes

**Engine mode (default).** Fully offline and deterministic — no API key, no network calls beyond
reading the listing itself. The naming engine, USP ranking, accuracy gate and scorer are all local.

**Engine + Claude.** Set a key and Claude proposes additional names *from the same fact sheet*:

```bash
npm install                       # installs @anthropic-ai/sdk
cp .env.example .env              # then put your key in ANTHROPIC_API_KEY
```

Claude proposes; the engine still decides. Every AI name goes through the same accuracy gate,
character limit and scorer, and anything that claims something the listing does not confirm is
discarded and reported. The model defaults to `claude-opus-5` (`OTA_NAMER_MODEL` to change it).
The raw page is never sent — only the verified fact sheet.

---

## How names are scored

Out of 100, across the eight criteria in the brief:

| Criterion | Weight | Criterion | Weight |
|---|---|---|---|
| USP strength | 22 | Differentiation | 12 |
| Guest appeal | 16 | Readability | 8 |
| Clarity | 14 | Character efficiency | 8 |
| Property relevance | 14 | OTA suitability | 6 |

Naming approaches used: **USP Focused**, **Experience Focused**, **Location Focused**,
**Luxury Focused** (only with listing evidence of luxury), **Group/Family Focused** (only when
the size and facilities suit them), and **Existing Name + USP** (when the listing has a brand
name worth keeping).

The preferred shape is *size + strongest USP + property type + location* —
`6BHK Hilltop Villa • Private Pool • Karjat` — but it is a guideline, and the engine picks the
structure that suits the property.

---

## Project layout

```
server.js              zero-dependency HTTP server + JSON API
lib/
  knowledge.js         the domain knowledge: USP catalog, weights, wording rules, violations
  ota.js               OTA detection, URL normalisation, private-address guard
  fetcher.js           one polite request; classifies html / json / text and detects challenges
  extract.js           the five-route strategy chain, and merging what each route found
  render.js            headless Chrome/Edge over CDP, with the gate boundary above
  log.js               structured per-analysis trace, safe by construction
  parsers/
    index.js           HTML → signals (JSON-LD, embedded state, meta, page text) + pasted text
    json.js            JSON/API payload → signals, and placeholder-response detection
    adapters.js        what we know about each OTA: selectors, key aliases, stub shapes, notes
  capture.js           the browser-capture channel: snippet, in-memory store, trusted section
  urlfacts.js          the property name, city, type and BHK carried by the listing path
  facts.js             signals → verified fact sheet, with zones, sources, evidence and overrides
  usp.js               ranks USPs for this specific property
  names.js             builds title candidates and fits them to the limit
  validate.js          the accuracy gate + OTA guideline checks
  score.js             scores out of 100 and explains the score
  llm.js               optional Claude pass (official Anthropic SDK, lazily loaded)
  analyze.js           the pipeline
public/                dashboard (index.html, styles.css, app.js)
test/
  run-tests.js         108 engine assertions
  extraction-tests.js  103 extraction assertions
```

## API

`POST /api/analyze`

```json
{
  "url": "https://www.airbnb.co.in/rooms/12345678",
  "maxChars": 50,
  "useAi": true,
  "useRender": true,
  "useCapture": true,
  "pastedText": "optional page text or page source",
  "overrides": {
    "name": "Vista Dazzle",
    "location": "Karjat",
    "propertyType": "Villa",
    "bedrooms": 6,
    "guests": 12,
    "bathrooms": 6.5,
    "addUsps": ["Panoramic mountain view"],
    "removeUsps": ["bbq"]
  }
}
```

Returns the fact sheet with sources, the ranked USPs (confirmed, commodity and unconfirmed), the
recommended name with its score breakdown and reasons, the alternatives, the discarded candidates,
the extraction trace, and any warnings — plus `needsCapture` and a `capture` block when the page
could not be read. A failure returns the same trace plus `reason` and the OTA-specific note.

The capture channel: `POST /api/capture` receives a captured page (this one route accepts
cross-origin POSTs, because they come from the OTA's own page; the server binds to 127.0.0.1 and
only accepts the current session token), `GET /api/capture/status?url=` reports whether one has
arrived, `GET /api/capture/snippet` returns the bookmarklet and console forms, and
`POST /api/open-listing` opens a URL in the default browser. `GET /api/status` reports whether the
Claude pass, rendering and capture are available.

## Tests

```bash
npm test
```

211 assertions, no network access and no API key:

- **Engine (108)** — OTA detection and the private-address guard, fact extraction with sources,
  USP ranking (commodity demotion, same-feature de-duplication), the accuracy gate against nine
  invented claims, the shortening ladder at five character limits, manual corrections, the
  pasted-text path, sparse listings, scoring.
- **Extraction (103)** — JSON payloads producing a full fact sheet, placeholder responses named as
  such, page-zone features excluded from names but reported and confirmable, a neighbour's stronger
  wording never displacing the property's own feature, merging across routes, the property name and
  city read from four OTA URL shapes, the capture channel (token refusal, trusted section, amenity
  lines, neighbours quarantined), and the character limit held at seven different limits.
