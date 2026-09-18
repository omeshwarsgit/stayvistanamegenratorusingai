---
name: browser-capture-route
description: MakeMyTrip and Goibibo only serve a listing inside their own site session, so the fallback is capturing the page from the user's own browser.
metadata:
  type: project
---

MakeMyTrip answers a listing URL from outside its own site session with a six-byte body — the
literal string `200-OK` — under `Content-Type: application/json`. Goibibo answers with an eight-byte
`200 - OK`. A real headless Chrome, with a normal user agent, is served the same thing. There is no
listing in the response, so retrying, parsing harder or rendering again cannot recover one.

The working fallback is `lib/capture.js`:

1. The dashboard offers **Capture from my browser** and can hand the URL to the user's default
   browser (`POST /api/open-listing`).
2. The user runs a one-line snippet on that page — a bookmarklet, or a console paste from
   `GET /api/capture/snippet`. It posts the page's visible text, its main property section, its
   JSON-LD and its `og:` tags to `POST /api/capture`.
3. The dashboard polls `GET /api/capture/status?url=` and re-analyses automatically when it lands.

Details that matter:

- **Only the property's own section is trusted.** `trustedSection()` cuts the captured text at
  "similar properties", "you may also like", "popular filters" and friends, and caps it at 3000
  characters. `amenityLines()` reads the list under an "Amenities" heading. See
  [[trusted-vs-page-zone]].
- **A site's CSP can block the snippet's `fetch`**, so it falls back to opening
  `/capture/receive#<payload>` — navigation is not restricted by `connect-src`.
- **Security:** the server binds to 127.0.0.1; the capture route is the only cross-origin endpoint
  and requires the per-session token; captures live in memory for 15 minutes; only
  `og:`/`twitter:`/`place:`/`description` meta keys are kept.
- **A placeholder URL is remembered** (`knownStubs` in `extract.js`) so no route repeats it. When
  testing that path, restart the server or the skip will look like a bug.

**Why this and not automation:** the user navigating to the listing and handing over what is on
their screen is within their gift. Automating the site navigation that makes the placeholder go
away would be circumventing the control, which this project rules out — see
`project-brain/DECISIONS.md` D-004 and D-010. Related: [[ota-serverside-readability]],
[[accuracy-gate-invariant]].
