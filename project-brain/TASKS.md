# ✅ Tasks — ota-name-generator

## Done

| ID | Task |
|---|---|
| T-001 | Project scaffolding + Project Brain |
| T-002 | USP knowledge base: catalog, title weights, wording rules, property types, violations |
| T-003 | Fetcher: single polite request, timeout, size cap, challenge/login detection, SSRF guard |
| T-004 | Parser: JSON-LD + embedded app state + meta + page text, with per-fact source and evidence |
| T-005 | USP ranking adapting to size, guest fit, property type, title emphasis and repetition |
| T-006 | Name generation across six styles + shortening ladder to any character limit |
| T-007 | Accuracy gate (fact-sheet vocabulary, gated qualifier words) + OTA guideline checks |
| T-008 | 100-point scorer with per-criterion breakdown and "Why this name?" reasons |
| T-009 | Dashboard: analysis tiles with sources, USP priority, best name, alternatives, corrections, error/paste states |
| T-013 | Optional Claude pass with local re-validation and graceful degradation |
| T-014 | 108 engine tests + live verification across all five OTAs |
| T-015 | README (rules enforced, per-OTA reality, API) + brain population |

## Backlog (nothing blocking)

| ID | Task | Note |
|---|---|---|
| T-010 | Bookmarklet/extension posting page source from the user's browser to `/api/analyze` | Only sanctioned route to Booking.com/MMT coverage; never add bot-protection bypass |
| T-011 | Extend `USP_CATALOG` as real listings surface unknown features | Weight = title strength, not niceness; `needsExplicit` for qualifier labels |
| T-012 | Persist analyses so a property's previous recommendation can be compared | Only if the team wants history |
