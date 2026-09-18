# 📓 Changelog — ota-name-generator

## 2026-09-11 (later) — v1.4: a title per OTA

**New**

- `lib/otastyle.js` — a naming profile per platform, and the candidate wordings each one prefers:
  - **Airbnb** — 44-char ceiling, no city (the card shows it), no pipes, one natural phrase.
  - **Booking.com** — house name first, since Booking treats the title as the property name.
  - **MakeMyTrip** — BHK first, city at the end, abbreviations allowed to fit.
  - **Agoda** — bedroom count spelled out ("4-Bedroom"), no BHK, city kept.
  - **Goibibo** — BHK plus the feature pair or capacity groups compare on, city kept.
- `otaNames` in the API: one validated, scored title per OTA with its character count, main USP,
  what was trimmed to fit, and a one-line rationale.
- A "Name for each OTA" card grid in the dashboard: a glyph per platform in the brand palette
  (neutral marks, not trademarked logos), the title, its counter, and a per-platform Copy button.
- 40 more extraction assertions covering each profile's conventions and a 32-character squeeze.

**Changed**

- Per-OTA candidates always carry the full verified label; abbreviation is a fitting step and only
  runs where that audience reads it, so Agoda no longer sees "Pvt Pool".
- `sizeWords` is hyphenated ("4-Bedroom"), which is how international listings read.

**Verified** on two live pages. The Infinity Heaven: Airbnb `Secluded 4BHK Villa with Private Pool`
(37/44), Booking.com `Infinity Heaven - 4BHK Villa with Private Pool` (46/50), MakeMyTrip
`4BHK Villa with Private Pool, New Delhi` (39/50), Agoda
`4-Bedroom Villa with Private Pool, New Delhi` (44/50), Goibibo
`4BHK Villa | Private Pool & Jacuzzi, New Delhi` (46/50).

---

## 2026-09-11 — v1.3: StayVista as the source

The tool is now a StayVista → OTA naming tool: the user gives a StayVista property URL and gets
the title to publish on the OTAs. OTA listing URLs still work as a secondary path.

**New**

- `lib/parsers/stayvista.js` — a dedicated reader for StayVista property pages: the schema.org
  `Hotel` block (name, bedrooms, bathrooms, description, rating) plus the `__NEXT_DATA__` payload
  (city, `max_occupancy`, highlights, categorised amenities) — and the **unavailable** amenity
  list, which is honoured as a denial.
- `stayvista` recognised as a source in `lib/ota.js` and `lib/parsers/adapters.js`.
- Denial and negation guards in `facts.js`: a feature the page lists as unavailable can never be
  claimed, and wording like "No Wi-Fi is available" or "this is not a pet-friendly property" does
  not confirm a feature. Negation only counts in the run-up to a match, so "a sun deck you cannot
  resist" no longer denies the sun deck.
- OTA title format: pipe-separated blocks with the town after a comma
  (`4BHK Villa | Pvt Pool & Jacuzzi, New Delhi`), "Pvt Pool" as the short form, and the four
  structures the brief names (BHK-led, name-led, USP-led, and no-location).
- Five structurally distinct options per analysis, each with its character count and main USP,
  plus a one-sentence recommendation (`options` and `recommendation` in the API).
- Phrase-level accuracy check: a wording that upgrades what the page confirms is refused even when
  every individual word is allowed.
- New USPs: In-House Bar, Sun Deck, EV Charging, Staff Quarters.

**Changed**

- Dashboard relabelled for StayVista input, with Top USP / Secondary USP / Key Amenities in the
  analysis block and the five options replacing the flat suggestion list.
- `README.md` rewritten for the StayVista-first flow.

**Verified** on live pages: Bel Air Mansion (Lonavala) → `4BHK Villa | Pvt Pool & Lawn, Lonavala`;
The Infinity Heaven (New Delhi/Faridabad) → `4BHK Secluded Villa | Private Pool, New Delhi`, with
9 unavailable features correctly kept out of every name.

**Fixed:** BUG-017 … BUG-019.

---

## 2026-09-10 (later still) — v1.2: browser capture and URL facts

Prompted by the MakeMyTrip placeholder: stop retrying a request that cannot work, and give the user
a fallback that does.

**New**

- `lib/capture.js` — the browser-capture channel: a per-session token, an in-memory store (15 min,
  20 captures), the capture snippet in bookmarklet and console forms, a receive page for sites whose
  CSP blocks a direct POST, and the logic that decides which part of a captured page is the property
  describing itself (cut at "similar properties" and friends) plus its amenity list.
- `lib/urlfacts.js` — the property name, city, type and BHK carried by the listing path, per OTA,
  sourced `url` and merged last.
- Server routes: `POST /api/capture`, `GET /api/capture/status`, `GET /api/capture/snippet`,
  `GET /capture/receive`, `POST /api/open-listing`. The server now binds to 127.0.0.1.
- Dashboard: a **Capture from my browser** panel (open the listing, run the snippet, auto-analyse
  on arrival) that appears alongside a partial result rather than replacing it with an error.
- 44 more extraction assertions (URL facts across four OTA URL shapes; the capture channel).

**Changed**

- `lib/extract.js` is now a seven-route chain (capture → HTML → JSON → embedded → OTA-specific →
  render → URL) and remembers which URLs answered with a placeholder, so neither the fetch nor the
  render route repeats pointless work. MakeMyTrip now resolves in 0.3s instead of 4.8s.
- `lib/analyze.js` returns a partial analysis plus a capture offer instead of a hard error whenever
  the URL still carries usable facts.
- Confirmed features beat unconfirmed ones in same-feature de-duplication (BUG-014).
- Prefilled correction fields are no longer resubmitted as manual overrides (BUG-015).
- A brand that spells itself with inner capitals keeps them ("StayVista", not "Stayvista").

**Verified end to end:** paste the MakeMyTrip URL → immediate partial analysis
(`StayVista Mehta Mansion • Villa • Lonavala`) with the capture panel → capture the page in the
browser → automatic re-analysis → `4BHK Hilltop Villa • Private Pool • Lonavala`, 44/50, 98/100,
with 4 bedrooms, 10 guests, 12 amenities and 13 ranked USPs, and the neighbouring listing's
infinity pool, jacuzzi and home theatre correctly quarantined as unconfirmed.

---

## 2026-09-10 (later) — v1.1: multi-route extraction

Prompted by a MakeMyTrip URL failing with "The URL returned application/json rather than a listing
page".

**New**

- `lib/extract.js` — the five-route strategy chain (HTML → JSON → embedded JSON → OTA-specific →
  browser rendering), merging results across routes and stopping once enough fields are in hand.
- `lib/parsers/json.js` — JSON/API payloads mined by key name into the standard signal shape,
  plus placeholder-response detection.
- `lib/parsers/adapters.js` — per-OTA knowledge: script selectors, JSON key aliases, placeholder
  shapes, and the human-readable note the dashboard shows on failure.
- `lib/render.js` — headless Chrome/Edge over CDP with zero dependencies (Node's global
  `WebSocket`); serialised, temp profile, idle shutdown, and a hard stop at bot-protection
  challenges, CAPTCHAs and login walls.
- `lib/log.js` — structured per-analysis trace, printed to the console and returned by the API;
  no headers, cookies or tokens, and URLs logged without query strings.
- `test/extraction-tests.js` — 59 assertions covering all of the above.

**Changed**

- `lib/fetcher.js` classifies responses (`html`/`json`/`text`/`binary`) and no longer treats JSON
  as a failure; only unreadable binary is rejected.
- Trusted/page zones throughout `facts.js`, `usp.js`, `validate.js`: features found outside the
  listing's own copy are reported and confirmable but never used in a name.
- `detectPropertyType` scans sources in priority order, earliest-and-longest match within each.
- Proximity language guards setting and view claims; page-body guest counts cannot enter a title.
- `names.js` gained no-USP fallback templates; the dashboard gained one-click confirmation of
  page-zone features, the extraction trace in the footer, and the routes-tried list on failure.
- `README.md` rewritten around the extraction chain, the zone rule and the per-OTA reality.

**Findings recorded** (see `memory/ota-serverside-readability.md`): MakeMyTrip serves a six-byte
`200-OK` placeholder and Goibibo an eight-byte `200 - OK`, to a rendering browser as well;
Booking.com serves an AWS WAF challenge; Agoda renders correctly in about 10–20 seconds; Airbnb
still works directly.

**Fixed:** BUG-010 … BUG-013 (see `BUGS.md`) — including literal 0x08 bytes written by an earlier
patch script where `\b` was intended, which had silently disabled two regex sets.

---

## 2026-09-10 — v1 built in one session (Claude Opus 5, Claude Code desktop)

**Created the project and its brain**

- `ota-name-generator/` scaffolded under the workspace root; Project Brain created from
  `universal-project-brain/init-brain.ps1`.
- `package.json` (ESM, Node >= 20, no runtime deps, `@anthropic-ai/sdk` as an optional
  dependency), `.env.example`, `.gitignore`.

**Engine**

- `lib/knowledge.js` — USP catalog (~95 entries) with title weights, `needsExplicit` wording
  rules, `feature`/`category` grouping, commodity flags, 21 property types, luxury evidence
  patterns, gated qualifier words, safe shortenings, OTA title violations.
- `lib/ota.js` — OTA detection for the five OTAs, URL normalisation, private-address guard.
- `lib/fetcher.js` — one request with browser headers, 20 s timeout, 3.5 MB cap, bot-challenge
  detection (AWS WAF, PerimeterX, DataDome, Cloudflare, Incapsula) and login-wall detection.
- `lib/html.js` — entity decoding, text extraction, JSON-LD, script JSON, meta tags, key-name
  JSON walking.
- `lib/parsers/index.js` — page to signals from JSON-LD, embedded app state, meta and page text,
  each with source and evidence; `parseText` for pasted details; amenity-object harvesting;
  room-type line detection.
- `lib/facts.js` — verified fact sheet, USP matching with feature de-duplication, brand
  extraction, luxury evidence, guest-fit derivation, coverage scoring, manual overrides.
- `lib/usp.js` — per-property USP ranking with reasons; natural combo labels.
- `lib/names.js` — 18 segment templates across six naming styles; duplicate-word removal;
  shortening ladder; character-limit clamp.
- `lib/validate.js` — accuracy gate (fact-sheet vocabulary, per-unit size checks, gated words)
  and OTA guideline checks.
- `lib/score.js` — 100-point score across the brief's eight criteria, with breakdown, reasons and
  best-name selection.
- `lib/llm.js` — optional Claude pass: `claude-opus-5` by default, adaptive thinking,
  strict-schema `propose_names` tool, server-side fallbacks with graceful degradation, fact sheet
  only on the wire.
- `lib/analyze.js` — the pipeline and API response shape, including partial-coverage warnings and
  JS-rendered detection.

**Server and dashboard**

- `server.js` — `node:http`, static files, `POST /api/analyze`, `GET /api/status`, 200 KB body
  cap, minimal `.env` reader.
- `public/index.html` + `styles.css` + `app.js` — StayVista-branded dashboard (Warm White ground,
  Warm Black ink, Sky/Bloom/Shine accents, Marcellus + Inter): analysis tiles with source badges
  and evidence tooltips, Key USPs, USP Priority with strength bars, recommended-name hero with
  counter, score, reasons, breakdown and copy, alternatives with styles and scores,
  discarded-candidate disclosure, manual-correction panel with USP chips, error state with the
  paste box.

**Tests and verification**

- `test/run-tests.js` + `test/fixtures/airbnb-villa.html` — 108 assertions covering OTA detection,
  the SSRF guard, extraction with sources, USP ranking, the accuracy gate against nine invented
  claims, the shortening ladder at five limits, manual corrections, the pasted-text path, sparse
  listings, the apartment case and scoring.
- Live verification against real listing URLs on all five OTAs; findings recorded in
  `CONTEXT.json.lessonsLearned` and the README.

**Fixed during the session:** BUG-001 through BUG-009 (see `BUGS.md`).

**Documentation:** `README.md` (how to run, the rules enforced, per-OTA reality, modes, scoring,
layout, API, tests); brain files populated.
