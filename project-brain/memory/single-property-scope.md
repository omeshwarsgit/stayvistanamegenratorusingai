---
name: single-property-scope
description: The user explicitly scoped this tool to one property URL at a time — no Excel, bulk or batch generation.
metadata:
  type: feedback
---

The brief opens by narrowing scope: "focused only on one OTA property URL at a time, with no
Excel/bulk-upload functionality", and repeats it — "Do not add Excel upload, bulk processing, or
batch name generation."

**Why:** the user has other projects in this workspace that *are* bulk sheet-driven tools
(`booking-name-change`, `mmt-blackout-dates`), so the boundary here is deliberate rather than an
oversight. Adding a batch mode would restore scope the user actively removed.

**How to apply:** keep `/api/analyze` one property per call and keep the dashboard single-input. If
bulk ever comes up, ask first. Related: [[accuracy-gate-invariant]].
