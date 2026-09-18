# Memory Index — ota-name-generator

> Project-scoped memory. Load ONLY when working in this project. Never read another project's
> memory, and never copy anything from here into the global store.
>
> Each memory is one file in this folder with frontmatter:
> `name`, `description`, `metadata.type` (user | feedback | project | reference).
> Add a one-line pointer here per memory: `- [Title](file.md) — hook`.

- [OTA server-side readability](ota-serverside-readability.md) — only Airbnb serves listing content to a plain fetch; Booking/Agoda/Goibibo/MMT need the paste path.
- [Airbnb listing data location](airbnb-deferred-state.md) — everything useful is in the `data-deferred-state-0` JSON blob, not the rendered HTML.
- [Browser capture for session-gated OTAs](browser-capture-route.md) — MakeMyTrip/Goibibo only serve a listing inside their own session; the user's own browser is the fallback.
- [Trusted vs page zone](trusted-vs-page-zone.md) — only what a listing says about itself can name it; a rendered page carries neighbours, filters and area guides.
- [Accuracy gate is the product](accuracy-gate-invariant.md) — never widen the vocabulary gate to make a name pass; it is what makes the AI pass safe.
- [Single-property scope](single-property-scope.md) — the user explicitly ruled out Excel, bulk and batch generation.
