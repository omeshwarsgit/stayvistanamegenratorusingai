---
description: Sync the Project Brain with the current state of the repo and this session
---

You are performing a full **Project Brain sync** for the **active project only**. Follow
`BRAIN_PROTOCOL.md`. Do not read or touch any other project's brain or memory.

Steps:
1. Read the current `project-brain/` files, `project-brain/CONTEXT.json`, and
   `project-brain/memory/MEMORY.md`.
2. Reconcile the brain against reality:
   - Compare `CONTEXT.json.files` to what actually exists in the repo; add/remove/mark entries.
   - Fold anything decided or discovered in *this conversation* that isn't yet written:
     new decisions → `DECISIONS.md`, bugs → `BUGS.md`, completed/started work → `TASKS.md`,
     file/config/dependency/command changes → `CHANGELOG.md`, durable reusable facts →
     `memory/<slug>.md` + a pointer in `memory/MEMORY.md`.
3. Refresh the three handoff files: `HANDOFF.md`, `CURRENT_STATE.md`, `CONTEXT.json`
   (currentFocus, worksEndToEnd, broken, nextSteps, percentComplete).
4. Run the self-audit checklist from `BRAIN_PROTOCOL.md` and fix any drift.
5. Confirm `CONTEXT.json` is valid JSON.
6. Report a short summary: what you updated and the current "Do this next".

$ARGUMENTS
