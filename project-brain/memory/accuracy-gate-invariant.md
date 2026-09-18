---
name: accuracy-gate-invariant
description: The vocabulary accuracy gate is the core product promise — never widen it to make a name pass.
metadata:
  type: project
---

Every candidate title, whether written by the template engine or by Claude, must pass
`lib/validate.js`: each meaningful word has to trace back to a fact on the verified fact sheet, and
qualifier words (`private`, `infinity`, `heated`, `panoramic`, `beachfront`, `hilltop`, `luxury`,
and the rest of `GATED_WORDS`) unlock only when a USP whose label owns that word actually fired on
the listing.

**Why:** "never invent information" is the hardest requirement in the brief — a listing that says
"swimming pool" must never yield "Private Pool". Making it a mechanical gate rather than a prompt
instruction is also what makes the optional LLM pass safe: Claude proposes, the gate and the scorer
decide, and rejected AI names are surfaced to the user with reasons.

**How to apply:** when a name that *should* be legal gets rejected, the bug is almost always a
missing or mis-grouped fact upstream — see the `feature` vs `category` split in
`project-brain/DECISIONS.md` D-005. Fix the fact sheet, not the gate. User corrections and pasted
listing details are legitimate sources and enter the vocabulary as `manual` / `manual-added`.
Related: [[ota-serverside-readability]], [[single-property-scope]].
