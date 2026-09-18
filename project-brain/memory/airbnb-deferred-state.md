---
name: airbnb-deferred-state
description: Airbnb listing pages keep all usable data in the data-deferred-state-0 JSON blob; the rendered HTML text is nearly empty.
metadata:
  type: reference
---

An Airbnb room page fetched server-side is ~500 KB, but stripping it to text yields only ~670
characters of nav chrome. Everything useful lives in
`<script id="data-deferred-state-0" type="application/json">`:

- `"propertyType":"Tiny home"` and `"roomType":"Entire home/apt"` — the accommodation type
- `"personCapacity":4` — guest capacity
- `sharingConfig.title` — a summary line: `Tiny home in Lonavala · New · 1 bedroom · 2 beds · 2 bathrooms`
- amenities as objects: `{"__typename":"AmenityItem","available":true,"title":"Wifi","icon":"SYSTEM_WI_FI"}`

There is also one `ld+json` node of `@type: VacationRental` carrying name, address, description and
`aggregateRating`, and `og:description` carries the layout counts.

**Why:** searching this blob by *key name* rather than a fixed path survives Airbnb's frequent
redesigns. Amenity objects also need a type or availability check, or section headers like "What
this place offers" leak in as amenities.

**How to apply:** `lib/parsers/index.js` — `collectEmbedded` mines keys from the flattened blob and
`collectAmenityTitles` walks for amenity-shaped objects. Related: [[ota-serverside-readability]].
