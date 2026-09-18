# 📍 Current State — ota-name-generator

**As of:** 2026-09-10 20:40 · **Phase:** v1.1 (multi-route extraction) · **Status:** shipped

## Runs today

```bash
npm start     # http://localhost:5178   (Engine mode — no API key needed)
npm test      # 108 engine + 59 extraction assertions, 0 failed
```

## What works end to end

- **Airbnb URL → recommendation.** Verified on a live listing: 501 KB read, name/type/location/
  layout/rating extracted, 12 USPs ranked, 12 names passed the checks, recommendation
  `1BHK Tiny Home • Jacuzzi & Pool • Lonavala` (42/50, score 91).
- **Brief's reference property** (via the paste path on a Booking.com URL):
  `6BHK Hilltop Villa • Private Pool • Karjat` (42/50, score 98), USP priority
  Private Pool → Hilltop → Mountain View → Home Theatre → Large Lawn → Pool Table.
- **Blocked / JS-rendered OTA** → specific explanation + paste box (page text or page source).
- **Manual corrections** → add USP ("Panoramic valley view" adds both Valley View and Panoramic
  View), remove USP, edit name/location/type/counts, change the limit, regenerate. Verified in the
  browser: at a 38-character limit all 9 names fitted and the strongest USP was kept.
- **Accuracy gate** → rejects invented claims from either source; discarded candidates are listed
  in the UI with the reason.
- **Optional Claude pass** → code path complete; unexercised in this environment because no
  `ANTHROPIC_API_KEY` is set. It fails soft: an error there never blocks engine names.

## Known external limits (not defects)

| OTA | From a URL alone |
|---|---|
| Airbnb | works fully |
| Booking.com | AWS WAF challenge → paste path (page source works) |
| Agoda | JS-rendered → paste path (**visible page text**; page source is empty) |
| Goibibo | JS-rendered → paste path |
| MakeMyTrip | six-byte `200-OK` placeholder, rendering included → paste path |

Extraction now runs five routes in order (HTML → JSON → embedded JSON → OTA-specific → browser
rendering), merges what they find, and shows the trace in the UI and the server log. Agoda moved
from unreadable to readable via rendering. Rendering stops at bot-protection gates by design.

## Not started (and not required)

- Bookmarklet/extension to post page source from the user's own browser.
- Persisting analyses for before/after comparison.
- Any bulk flow — explicitly out of scope.
