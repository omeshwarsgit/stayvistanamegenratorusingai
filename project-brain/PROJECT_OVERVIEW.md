# 📋 Project Overview — ota-name-generator

**Started:** 2026-09-10 · **Status:** shipped (v1)

## The objective

Answer one question for one property at a time:

> "Based on everything available on this OTA listing, what is the most attractive and accurate
> name I should use for this property?"

The user pastes a single listing URL. The tool behaves like an OTA content specialist: read the
complete listing → understand the property → identify the strongest selling points → understand
the target guest → generate optimised names → validate accuracy → validate the character limit →
score each name → recommend the best one.

## Scope

**In scope**

- One property listing URL per analysis, OTA auto-detected (Airbnb, Booking.com, MakeMyTrip,
  Agoda, Goibibo; other hosts fall back to generic extraction with a warning).
- Reading the whole public listing — not just the title: description, amenities, facilities,
  layout, capacity, views, pool details, outdoor and indoor features, games, BBQ, bonfire,
  jacuzzi, balcony/terrace, lawn, parking, Wi-Fi, pet and family features, work features,
  nearby/proximity mentions and any other stated USP.
- Ranked USPs (not an amenity dump), 10–15 scored name suggestions across six naming styles,
  one recommended name with reasons, and a manual-correction loop.
- A configurable character limit, default 50, never exceeded.

**Out of scope, deliberately**

- Excel upload, bulk processing, batch name generation.
- Any bypass of login walls, CAPTCHAs, bot protection or OTA access controls.
- Inventing information. If the listing does not say it, the tool cannot write it.

## Who it is for

StayVista OTA content operations — someone improving a live listing's title and needing a
defensible, accurate, click-worthy name quickly, with the evidence visible.

## What "good" looks like

For the brief's own example property, the tool produces:

```
6BHK Hilltop Villa • Private Pool • Karjat      42/50 characters, score 98
```

with USP priority `Private Pool → Hilltop → Mountain View → Home Theatre → Large Lawn → Pool
Table`, and it refuses to write "Private Pool" on any listing that only says "swimming pool".

## Success criteria

| Criterion | Status |
|---|---|
| One URL in, ranked USPs + scored names out | met |
| Names built only from verified listing facts or user-supplied corrections | met, enforced by a vocabulary gate and covered by tests |
| Character limit always respected, strongest USP preserved when shortening | met, tested at 30/35/40/50/60 |
| 10–15 suggestions across distinct naming approaches, each scored | met |
| One clearly recommended name with reasons and a copy button | met |
| Honest handling of unreachable or partial listings, with a manual path | met |
| No Excel/bulk anything | met |
