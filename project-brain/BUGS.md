# 🐞 Bugs — ota-name-generator

No open bugs. All of the below were found by the engine test suite or by running real listings,
and each has a regression test.

## Fixed

| ID | Symptom | Cause | Fix |
|---|---|---|---|
| BUG-001 | Only one commodity amenity ever appeared (Wi-Fi vanished) | All commodities shared `category: 'commodity'` and de-duplication kept one per category | Gave each commodity its own category; de-duplication now keys on `feature` |
| BUG-002 | "sweeping mountain views" did not register as a view USP | View patterns matched only the singular `view\b` | Made every view pattern plural-tolerant |
| BUG-003 | `8BHK Villa • Pool • Karjat` passed on a 6-bedroom property | Size tokens were validated against *any* verified number, and the property had 8 beds | Size tokens are checked against the count for their own unit (rooms/beds/baths) |
| BUG-004 | A name rendered as `6BHK Hilltop Retreat • Pool & • Karjat` | Duplicate-word removal stripped "Hilltop" from a combo label and left the connector | `trimConnectors()` after de-duplication |
| BUG-005 | Adding "Panoramic mountain view" manually did nothing | Only the first matching catalog entry was considered, and its category was already present | Manual text now adds every entry it matches whose feature is absent |
| BUG-006 | `ftp://example.com/x` was accepted as a listing URL | `https://` was prepended to anything without an http(s) prefix | Reject any explicit non-http(s) scheme |
| BUG-007 | Pasted details produced no property name or location | `parseText` never looked for either | First line is a name candidate; the location pattern no longer needs punctuation after the place |
| BUG-008 | Pasted facts were labelled "You confirmed this feature" | `manual` covered both pasted content and explicitly added USPs | Split into `manual` and `manual-added`, with distinct labels in the UI |
| BUG-017 | Every brand-led title was rejected for a villa called "The Infinity Heaven" — "Not supported by the listing: infinity" | "Infinity" is a gated claim word (there to stop invented "Infinity Pool"), and the word-level gate had no way to tell a claim from the property's own name | Words from the verified property/brand name now unlock their gated forms, and a new phrase-level check refuses any wording that *upgrades* what the page confirms ("Infinity Pool" still fails, "Infinity Heaven" passes). 7 regression assertions added |
| BUG-018 | An in-house bar was invisible to the ranker | No `bar` entry in the USP catalog | Added `bar` (In-House Bar, weight 66, group/luxury) |
| BUG-019 | The `bar` regex silently never matched after being added | A patch script wrote literal 0x08 bytes for `\b` again — the same trap as BUG-010 | Repaired and re-verified; the control-character grep is in HANDOFF and should be run after *every* scripted edit |
| BUG-014 | A neighbouring listing's "infinity pool" (weight 97) displaced the property's own confirmed "private pool" (96), which was then filtered out for being unconfirmed — the property lost its pool entirely | Same-feature de-duplication ranked by weight only | A confirmed feature always beats an unconfirmed one; weight only breaks ties between equals. Regression test added |
| BUG-015 | After a browser capture arrived, the correction fields we had prefilled were resubmitted as manual overrides, shadowing the better data | `collectOverrides` could not tell a prefilled value from a user edit | Prefilled values are recorded in `dataset.prefill` and only sent when the user has changed them |
| BUG-016 | A BHK count in a URL slug was never read | `4bhk_pool_villa` — an underscore is a word character, so `\bbhk\b` never matched | Read the count from the resolved name instead of the raw slug |
| BUG-010 | `roomTypeLine` never matched, and the "Tiny Home" property type patterns were dead | A patch script wrote literal backspace bytes (0x08) where `\b` word boundaries were intended — invisible in most editors and in grep output | Replaced the control characters and audited every source file for them; noted in HANDOFF so patch scripts use raw strings |
| BUG-011 | A rendered Agoda hotel page produced `River View Farm House • Pool` for a city hotel | The page text carried neighbouring listings, a property-type filter list and an area guide; all of it counted as evidence about this property | Trusted/page zones, proximity guard, type detection by source priority and earliest match (D-009) |
| BUG-012 | A rendered hotel page produced `Hotel for 30` | The guest count came from a function-room capacity in the page body | A guest count needs a structured source before it can enter a title |
| BUG-013 | A listing with nothing confirmed produced no names at all | Every name template required a USP | Added no-USP fallback templates (size + type + location, brand + location), which score low on differentiation as they should |
| BUG-009 | Best name read `1BHK Gated Tiny Home • Jacuzzi` | Any setting/view USP could sit in front of the property type | The pre-type modifier slot now requires strength ≥ 70 |
