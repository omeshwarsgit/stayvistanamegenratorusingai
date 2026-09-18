---
name: ota-serverside-readability
description: Which OTA listing pages can be read by a plain server-side fetch, and what to do about the ones that cannot.
metadata:
  type: project
---

Measured 2026-09-10 against real listing URLs, first with a plain fetch and then with local
headless Chrome:

| OTA | Plain fetch | Rendered in a real browser |
|---|---|---|
| Airbnb | full content (~500 KB); extraction works | not needed |
| Agoda | HTTP 200 shell: empty `<title>`, empty `ld+json`, no og tags | **works** — full fact sheet, 10–20s |
| Booking.com | HTTP 202 with an AWS WAF challenge (`awsWafCookieDomainList`) | deliberately not attempted (it is a gate) |
| MakeMyTrip | HTTP 200, `application/json`, body is the six characters `200-OK` | **same placeholder** |
| Goibibo | HTTP 200, body is `200 - OK` (8 bytes) | **same placeholder** |

Two more things worth knowing:

- Headless Chrome must be given an explicit `--user-agent`; with the default HeadlessChrome UA,
  MakeMyTrip fails the request with `ERR_HTTP2_PROTOCOL_ERROR`.
- MakeMyTrip and Goibibo are the same group, and both placeholders appear only for requests that
  arrive outside their own site session. There is no listing in the response to parse, so more
  parsing effort cannot help — the honest move is to name the placeholder and offer the paste path.

**Why:** it determines the product's shape. Rendering is legitimate for a page that builds itself
in the browser (Agoda), but the brief forbids bypassing access controls — so the renderer stops
at any challenge, CAPTCHA or login wall, and the paste path covers the rest.

**How to apply:** `lib/extract.js` runs the routes and reports each one; a byte-sized reply comes
back as `reason: 'stub'` and a challenge as `reason: 'blocked'`. A stub URL is remembered so it is
never retried, and both cases surface the **Capture from my browser** panel (see
[[browser-capture-route]]) with the paste box as a manual alternative. Page *source* pastes work for Airbnb; for Agoda the user must
paste the *visible page text*, because the source genuinely contains no property data. See
[[accuracy-gate-invariant]] for why pasted content is still a legitimate source, and
[[trusted-vs-page-zone]] for why a rendered page needs zoning.
