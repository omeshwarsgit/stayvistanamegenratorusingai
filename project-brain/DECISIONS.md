# 🧭 Decisions — ota-name-generator

Newest first. Each entry records the *why*, so a future session does not undo it by accident.

---

## D-013 · 2026-09-11 · One title per OTA, from platform conventions rather than one universal name

**Decision.** Alongside the five structural options, the tool writes one title per platform from a
profile in `lib/otastyle.js`: character ceiling, whether the city belongs, whether the house name
leads, whether "BHK" or a spelled-out bedroom count reads better, and whether Indian abbreviations
are appropriate. Every per-OTA title goes through the same accuracy gate and scorer.

**Why.** The same property does not want the same title everywhere. Airbnb prints the location
under each card and truncates long titles, so a city in the title is wasted characters; Booking.com
treats the title as the property's name; MakeMyTrip and Goibibo serve guests who search
"4BHK villa in <city> with private pool"; Agoda's audience does not read "BHK" as a room count.

**Honesty about the basis.** These are conventions drawn from how listings on each platform read,
not quoted policy, and the module says so. They are defaults a listing manager can override, not
rules the tool claims authority for.

**Icons.** Real OTA logos are trademarked assets, so the cards use neutral glyphs in the brand
palette rather than fetching or embedding logos.

---

## D-011 · 2026-09-10 · The URL is a fact source of last resort

**Decision.** Every analysis ends with a route that reads the listing path: the property name, the
city, and sometimes the type or a BHK count, all sourced `url`. It is merged last, so anything read
from the page wins. A listing that cannot be fetched therefore produces a partial analysis and a
usable name instead of an error screen.

**Why.** `/hotels/stayvista_mehta_mansion_villa-details-lonavala.html` contains "StayVista Mehta
Mansion Villa" and "Lonavala". That is public, checkable information the user themselves supplied —
withholding it and showing an error was throwing away facts we had. The user asked not to be shown
an error merely because an OTA replied with a placeholder, and this is what makes that possible.

**Guard rails.** Slug-derived facts are labelled "From the URL" in the dashboard and are the
weakest source in the merge, so a capture or a page read replaces them silently.

---

## D-010 · 2026-09-10 · Capture the listing from the browser the user is already using

**Decision.** When a page cannot be read, the dashboard offers **Capture from my browser**: it
opens the listing in the user's default browser, gives them a one-line snippet (bookmarklet or
console paste) that posts the page's own visible content to `http://127.0.0.1:5178`, and polls until
it arrives, then re-analyses automatically. The property's own section of the capture is trusted;
the rest of the captured page is not.

**Why.** MakeMyTrip and Goibibo serve a byte-sized placeholder to anything outside their own site
session — measured, and confirmed against a real headless browser. No amount of retrying, parsing
or rendering can recover a listing that is not in the response. The page the user is looking at is
the only readable copy, and handing it over is entirely within their gift: they navigated there,
they can see it, and the tool runs on their machine.

**Why not drive a browser through the site instead?** Because automating the navigation that makes
the placeholder go away is circumventing the control, which D-004 rules out. A user-initiated
capture of a page already on their screen is not.

**Safety.** The server binds to 127.0.0.1; the capture route is the only cross-origin endpoint and
accepts a per-session token; captures live in memory for fifteen minutes; only `og:`/`twitter:`/
`place:`/`description` meta keys are kept; the snippet sends text, not cookies or credentials.

---

## D-009 · 2026-09-10 · Split every page into a trusted zone and a page zone

**Decision.** USP matching reads the listing's own title, description (first 1500 characters),
amenity list and anything the user pasted or added as the *trusted zone*. The rest of the page is
the *page zone*: features found only there are reported to the user and confirmable in one click,
but they never enter a name or the naming vocabulary. Proximity language ("ten minutes from the
beach", "a farmhouse nearby", "the area's history") invalidates a setting or view claim in either
zone; a guest count read off the page body cannot enter a title.

**Why.** Browser rendering (D-008) made this urgent. A rendered Agoda hotel page produced
`River View Farm House • Pool` for a city Hyatt, because the page text carried neighbouring
listings, a property-type filter list and an auto-generated area guide describing an
18th-century farmhouse nearby. Every one of those readings was "on the listing page" and none of
them was true of the property. The accuracy promise has to be about *whose* feature it is, not
just whether the words appear.

**Also fixed here.** `detectPropertyType` now scans sources in priority order and, within a
source, takes the earliest and longest match — so "a 3-star hotel" in the opening line beats
"farmhouse" two thousand characters later, instead of the catalog's own ordering deciding.

---

## D-008 · 2026-09-10 · Render with the installed browser over CDP, and stop at gates

**Decision.** The last extraction route drives locally installed Chrome or Edge headlessly over
the DevTools protocol, using Node's built-in WebSocket — no Puppeteer, no Playwright, no browser
download. If the rendered page turns out to be a bot-protection challenge, a CAPTCHA or a login
wall, it reports `blocked` and stops.

**Why.** Agoda and Goibibo ship empty shells, so executing the page's own client-side app is the
only way to read content that is otherwise public — and it works: Agoda went from unreadable to a
full fact sheet. A browser download was rejected because this machine is RAM-constrained and
Chrome is already installed. The gate check is what keeps the feature on the right side of the
brief's "do not bypass CAPTCHA, login walls, bot protection or access controls": rendering
executes a page, it does not defeat a challenge.

**Cost.** Rendering adds roughly 10–20 seconds. It only runs when the earlier routes came up
short, one page at a time, and the browser exits after a minute idle. `OTA_RENDER=0` disables it.

---

## D-007 · 2026-09-10 · A JSON response is a listing to parse, not an error

**Decision.** `Content-Type: application/json` no longer fails the fetch. The response is
classified (`html` / `json` / `text` / `binary`) and a JSON body goes to a parser that mines the
payload by key name — `propertyName`, `maxGuests`, `amenityName`, and the rest — producing the
same signals as the HTML parser, sourced `api`. Only genuinely unreadable binary responses are
rejected outright. The manual paste path is offered only after all five routes have failed.

**Why.** A MakeMyTrip URL was being rejected with "The URL returned application/json rather than a
listing page", which told the user nothing useful and skipped straight to manual entry.

**What it turned out to be.** MakeMyTrip answers requests from outside its own site session with a
six-byte body — the literal string `200-OK` — under a JSON content type, and Goibibo answers with
an eight-byte `200 - OK`. A real rendering browser is served the same placeholder. So no amount of
JSON parsing recovers a listing there; the honest outcome is to name the placeholder, say that
rendering saw it too, and hand over to the paste path. That distinction — "we cannot parse this"
versus "there is nothing here to parse" — is now visible in the UI and in the logs.

---

## D-006 · 2026-09-10 · Titles are prioritised segments, shortened by substitution then removal

**Decision.** A candidate name is a list of `{text, priority}` segments joined with `•`. To fit a
character limit: apply safe substitutions, then USP short forms, then drop the lowest-priority
segment — repeatedly.

**Why.** The brief requires the limit to be respected *while preserving the strongest USP*.
Truncation would break words and could cut the USP; a priority-ordered structure guarantees the
size, top USP and location are the last things to go, and it lets the UI tell the user exactly
what was shortened or dropped.

**Alternative rejected.** Regenerating shorter names from scratch — slower and gives no account of
what was sacrificed.

---

## D-005 · 2026-09-10 · Split USP identity into `feature` and `category`

**Decision.** `feature` groups alternative wordings of the same fact (Pool / Private Pool /
Infinity Pool) and only the strongest survives. `category` groups things that shouldn't share a
title (Pool Table and Indoor Games) but both remain as facts.

**Why.** A first version used one field for both, which silently deleted real features: a property
with a pool table *and* indoor games showed only the pool table, and "Pool & Games" was then
rejected by the accuracy gate because "games" was no longer in the vocabulary. The brief's own
example lists both, which is what surfaced it.

---

## D-004 · 2026-09-10 · No bypass of bot protection, CAPTCHAs or login walls

**Decision.** One ordinary request per analysis with normal browser headers. Challenges are
detected and reported. When a page cannot be read, the user is offered a paste box that accepts the
visible page text or the page source.

**Why.** Required explicitly by the brief, and the right call for OTA terms of service. It also
turns out to be sufficient: the user already has the listing open, and a page-source paste gives
the same structured extraction as a fetch.

**Consequence at the time.** Only Airbnb worked from a URL alone, documented in the README rather
than hidden.

**Refined by D-008.** Rendering a page's own client-side app is now a route, which added Agoda.
The boundary in this decision is unchanged and is enforced inside the renderer: a challenge,
CAPTCHA or login wall stops it. Rendering executes a page; it does not defeat a gate.

---

## D-003 · 2026-09-10 · Every fact carries a source and evidence; names may only use fact-sheet vocabulary

**Decision.** `{value, source, evidence}` on every fact; `validate.js` rejects any name containing
a word that does not trace back to one, with qualifier words gated behind the USP that owns them.

**Why.** "Never invent information" is the hardest requirement in the brief and the easiest to
violate by accident. A vocabulary gate makes it checkable rather than aspirational — and it is the
mechanism that lets an LLM contribute without being trusted. The evidence quotes also give the
user a reason to believe the analysis, and make wrong extractions obvious enough to correct.

---

## D-002 · 2026-09-10 · Zero runtime dependencies

**Decision.** `node:http` plus hand-rolled HTML/JSON extraction. No Express, no cheerio, no
Playwright. The Anthropic SDK is an `optionalDependency`, imported lazily.

**Why.** It is one internal page and one endpoint; a framework would add install weight for no
gain. Playwright was rejected because it downloads a browser onto a RAM-constrained machine.
Result: `npm start` works on a clean checkout with no install step.

**Still true after D-008.** Browser rendering arrived without breaking this: it drives the Chrome
or Edge already installed, over the DevTools protocol, using Node's global `WebSocket`. No
package, no download.

---

## D-001 · 2026-09-10 · Deterministic engine is the product; Claude is an optional enhancement

**Decision.** The naming engine, USP ranking, accuracy gate and scorer are local and deterministic.
If `ANTHROPIC_API_KEY` is present, Claude proposes additional names from the same fact sheet, and
every proposal is re-validated and re-scored locally before it can appear. The dashboard shows
which mode is active and reports discarded AI names.

**Why.** No API key was configured in this environment, so an AI-only design would have shipped
nothing runnable. More importantly, the accuracy guarantees are stronger when the last word belongs
to code: Claude proposes, the engine decides. Model default is `claude-opus-5`, overridable with
`OTA_NAMER_MODEL`; the call uses adaptive thinking, a strict-schema tool for the response, and
server-side fallbacks, degrading gracefully if the SDK or platform rejects those parameters.
