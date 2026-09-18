# 🤝 HANDOFF — read this first

> **New AI: start here.** This file is your 2-minute catch-up. Read it, then `CONTEXT.json`,
> then only the detailed files relevant to the next step. Do not ask the user to re-explain
> anything below — it's already here. Maintain this brain per `../BRAIN_PROTOCOL.md`.

**Last updated:** _2026-09-10 22:30_ · by _Claude Opus 5 (Claude Code desktop session)_

---

## In one paragraph

`ota-name-generator` is a single-property web tool for StayVista's OTA content work. You paste
**one** listing URL (Airbnb, Booking.com, MakeMyTrip, Agoda or Goibibo — auto-detected), and it
reads everything publicly available on that page — trying seven routes in turn (a capture from the
user's own browser, HTML, JSON/API payload, embedded JSON, an OTA-specific pass, rendering the page
in local headless Chrome, and finally the facts carried by the URL itself) —
builds a fact sheet where every fact carries its source and an evidence quote, ranks which features
would actually make a guest click, then writes 10–15 candidate titles, rejects any that claim
something the listing does not confirm, fits each to a character limit (50 by default), scores them
out of 100 and recommends one with a "why". It is deliberately **not** a bulk tool — no Excel, no
batch. v1.2 is complete, tested (108 engine + 103 extraction assertions) and verified against real
listing URLs on all five OTAs.

## Where we are right now

- **Phase:** v1.2 complete (browser capture + URL facts)
- **% complete (rough):** 100% of the brief
- **Currently working on:** nothing in flight
- **Works today:** Airbnb URL → direct read → recommendation; Agoda URL → browser rendering →
  recommendation; MakeMyTrip/Goibibo → placeholder detected once and never retried → partial
  analysis from the URL path plus a **Capture from my browser** panel → capture lands → automatic
  re-analysis → full result; Booking.com → challenge reported, capture or paste offered; JSON/API
  responses parsed by key name; page-zone features listed and confirmable in one click; manual
  corrections and regeneration; the accuracy gate; the optional Claude pass; `npm test`
- **Broken / incomplete:** nothing in the tool. The *external* limitations are per-OTA (see
  Gotchas)

## Do this next 👇

1. Run it on a handful of real StayVista listings (Airbnb and Agoda read directly; MakeMyTrip and
   Goibibo via **Capture from my browser**) and note any USP wording the catalog misses — add entries to `lib/knowledge.js`
   (`USP_CATALOG`), each with a `weight` that reflects title strength, not niceness, and
   `needsExplicit: true` if the label adds a qualifier.
2. The sanctioned route for session-gated OTAs is already built: `lib/capture.js` plus the
   dashboard panel. If it gets daily use, package the snippet as a small browser extension (T-026)
   so it is one click with no bookmarklet setup. Do **not** add bot-protection or CAPTCHA
   bypassing, and do not automate the site navigation that makes a placeholder go away — that is a
   hard boundary of this project, enforced inside `lib/render.js` and stated in D-004/D-010.
3. Optional: set `ANTHROPIC_API_KEY` in `.env` and `npm install` to turn on the Claude pass, then
   compare its proposals against the engine's on real listings.

## Gotchas the next AI must know

- **Per-OTA reality** (measured 2026-09-10, re-check when one changes): Airbnb reads directly;
  Agoda needs the rendering route (10–20s); Booking.com serves an AWS WAF challenge; MakeMyTrip
  and Goibibo answer with byte-sized `200-OK` / `200 - OK` placeholders — *to a rendering browser
  too*, so there is genuinely nothing to parse and nothing to retry. The designed answer is
  **Capture from my browser** (`lib/capture.js`), with paste as the manual alternative.
- **A placeholder URL is remembered** in `extract.js` (`knownStubs`) for the life of the process,
  so neither the fetch nor the render route repeats it. If you are testing changes to that path,
  restart the server or the skip will confuse you.
- **The capture route trusts only the property's own section** — `trustedSection()` cuts at
  "similar properties", "you may also like", "popular filters" and friends. Widening that is how a
  neighbour's infinity pool ends up in your title.
- **Agoda page *source* pastes do not help** (its `ld+json` is empty and property data arrives by
  XHR) — the user must paste the *visible page text* there. Airbnb page source does help.
- **Headless Chrome needs an explicit `--user-agent`.** With the default HeadlessChrome UA,
  MakeMyTrip fails the request outright (`ERR_HTTP2_PROTOCOL_ERROR`).
- **Trusted zone vs page zone is load-bearing.** A rendered page carries neighbouring listings,
  filter labels and area guides. Only `signals.zones` (the listing about itself) can name a
  property; `signals.pageText` findings are reported as unconfirmed. Widening this to "fix" a
  missing USP will start inventing features — confirm them in the UI instead.
- **Never widen the accuracy gate to make a name pass.** `lib/validate.js` requires every
  meaningful word to trace to a verified fact, with `GATED_WORDS` (private, infinity, panoramic,
  luxury…) unlocked only by a USP label that fired. This is the core product promise and is what
  keeps the Claude pass safe.
- **USP `feature` vs `category`:** `feature` de-duplicates alternative wordings of the same thing
  (Pool / Private Pool → one), `category` limits one per *title* (Pool Table and Indoor Games both
  stay as facts, only one enters a name). Getting these confused silently loses facts.
- **Restarting the server on Windows:** `pkill -f "node server.js"` does not work; the old process
  keeps port 5178 and you will silently test stale code. Stop it by command line via PowerShell
  CIM (see "How to run it").
- **Do not write large JS files with bash heredocs** — regex-heavy content gets mangled and the
  write silently fails, and a heredoc containing an apostrophe or a curly `’` can fail to parse at
  all. Use the Write tool for new files, and write patch scripts to a file before running them.
- **In patch scripts, use raw strings for anything containing `\b`.** A non-raw Python string
  turned `\b` into a literal 0x08 byte, which silently disabled two regex sets and is invisible in
  editors and grep. After any scripted edit:
  `grep -nP '[\x00-\x08\x0b\x0c\x0e-\x1f]' lib/*.js lib/parsers/*.js`
- Node's `/tmp` on this machine is not the Git-Bash `/tmp`; use the session scratchpad path for
  temporary files read by node.

## How to run it

```bash
cd "C:\Users\tanve\OneDrive\Desktop\Claude Projects\ota-name-generator"
npm start          # http://localhost:5178
npm test           # 108 engine + 59 extraction assertions, no network, no API key
```

Environment switches: `OTA_RENDER=0` disables browser rendering, `OTA_CHROME_PATH` points at a
specific browser binary, `OTA_LOG=0` silences the per-analysis trace, `OTA_NAMER_MODEL` changes the
Claude model, `OTA_HOST` changes the bind address (default 127.0.0.1 — keep it local, the capture
route accepts cross-origin POSTs).

Clean restart (Windows):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Where the thinking lives

- Product opinion (what sells a stay, allowed wording): `lib/knowledge.js`
- Why each choice was made: `project-brain/DECISIONS.md`
- What the tool guarantees to the user: `README.md` → "The rules it enforces"
