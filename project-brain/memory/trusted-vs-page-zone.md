---
name: trusted-vs-page-zone
description: Only what a listing says about itself may name it; a page also carries neighbouring listings, filter labels and area guides.
metadata:
  type: project
---

Every extraction splits a page into two zones (`signals.zones` and `signals.pageText`):

- **Trusted zone** — the listing's own title, the first 1500 characters of its description, its
  amenity list, anything the user pasted, and any USP the user added. Features here are
  `confirmed` and may be used to name the property.
- **Page zone** — everything else, including the tail of a long description. Features here are
  reported in the dashboard as unconfirmed, are excluded from the naming vocabulary, and become
  usable only when the user clicks to confirm one.

On top of that, proximity language (`nearby`, `10 minutes from`, `walking distance`, `explore`,
`attractions`, `the area's`) invalidates *setting and view* claims in either zone — but not
amenity claims, since a pool mentioned in the same sentence as a landmark is still this
property's pool. A guest count read from the page body also cannot enter a title, because on hotel
pages it is usually a function-room capacity.

**Why:** this was found the hard way. Once browser rendering was added, a rendered Agoda page for
a city Hyatt produced `River View Farm House • Pool • New Brunswick` — the river view and the
farmhouse came from a "similar properties" block, a property-type filter list, and Agoda's
auto-generated area guide describing a restored 18th-century farmhouse nearby. Every word was on
the page; none of it was true of the property. Text proximity is not evidence of ownership.

**How to apply:** when a legitimate feature comes back unconfirmed, do not widen the zone — the
UI already lets the user confirm it in one click, and `overrides.addUsps` carries it into the
fact sheet as `manual-added`. Related: [[accuracy-gate-invariant]],
[[ota-serverside-readability]].
