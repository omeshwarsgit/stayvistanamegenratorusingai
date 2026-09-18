# 🗺 Roadmap — ota-name-generator

## v1 — delivered 2026-09-10

Single-property analysis from one URL: verified fact sheet with sources, ranked USPs, 10–15 scored
names across six styles, one recommendation with reasons, character-limit enforcement, manual
corrections, honest failure states with a manual paste path, optional Claude pass.

## Next, if the team wants it

1. **Page-source capture from the browser** (T-010) — a bookmarklet or small extension that posts
   the page source the user is already looking at. This is the only sanctioned way to cover
   Booking.com and MakeMyTrip; bot-protection bypassing stays out of scope permanently.
2. **Catalog growth** (T-011) — the USP catalog is the product. Every real listing that surfaces a
   feature it does not know is a cheap, high-value addition.
3. **History** (T-012) — keep each analysis so a listing's old and new titles can be compared, and
   so the effect of a rename can be tracked.

## Deliberately never

- Excel upload, bulk processing, batch generation — the tool is single-property by design.
- Defeating CAPTCHAs, login walls or bot protection.
- Generating a name from anything other than verified listing facts or the user's own corrections.
