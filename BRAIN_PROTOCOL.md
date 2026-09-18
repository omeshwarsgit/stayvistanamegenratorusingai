# Brain Protocol — rules for maintaining the Project Brain

> **This file is instructions for the AI, not for humans.** Any model working on the project
> must follow it. It is model-agnostic: Claude, GPT, Gemini, and Grok all obey the same rules.

---

## Prime directive

You are the active developer on this project. The `project-brain/` folder is the **single
source of truth**. After every *meaningful* action, update the brain so that a fresh AI with
zero prior context could take over from the files alone.

If the brain and the code ever disagree, the **code wins** — correct the brain to match reality,
and note the correction in `CHANGELOG.md`.

---

## Isolation directive (this brain belongs to ONE project)

This brain is scoped to **this project only**. It must never mix with any other project's brain.

- **Load only this project's brain** (`project-brain/` here) and its `project-brain/memory/`.
  Never read or cite another project's brain or memory. Another project's knowledge must never
  influence work here.
- **Write only into this brain.** New decisions, bugs, tasks, changelog, and memories go here —
  never into a sibling project or a shared/global store.
- If several projects live under one workspace root, the *active project* is the one you're
  working in or the user named; when unclear, ask.

---

## When to update (triggers)

Update the brain after any of these. Do it *as part of the same turn*, not "later":

| Trigger | Files to touch |
|---|---|
| Created / modified / deleted a file | `CHANGELOG.md`, `CONTEXT.json` (files[]), `CURRENT_STATE.md` |
| Made a design/technical decision | `DECISIONS.md` (+ `ARCHITECTURE.md` if structural) |
| Fixed a bug | `BUGS.md` (move open→fixed), `CHANGELOG.md` |
| Discovered a bug | `BUGS.md` (add to open), `CONTEXT.json` (bugs.open) |
| Completed a task / feature | `TASKS.md` (move to done), `CURRENT_STATE.md`, `CHANGELOG.md` |
| Started a new task | `TASKS.md` (→ in-progress), `CURRENT_STATE.md` (currentFocus) |
| Installed / removed a dependency | `ARCHITECTURE.md` (dependencies), `CONTEXT.json`, `CHANGELOG.md` |
| Changed architecture | `ARCHITECTURE.md`, `DECISIONS.md`, `CONTEXT.json` |
| Ran a significant command | `CHANGELOG.md` (with the command + result) |
| Changed configuration | `CHANGELOG.md`, `ARCHITECTURE.md` if it affects structure |
| Learned a durable, reusable fact | `memory/<slug>.md` + pointer in `memory/MEMORY.md` |
| **End of any work session** | `HANDOFF.md` + `CURRENT_STATE.md` + `CONTEXT.json` (always refresh these three) |

**"Meaningful" filter:** skip trivial noise (a typo fix, a reformat). Capture anything a future
developer would need to *understand* or *not redo*. When unsure, record it — brevity over omission.

---

## Write discipline per file

Files fall into two categories:

- **Append-only ledgers** — never rewrite history, only add entries (newest at top):
  `CHANGELOG.md`, `DECISIONS.md`. Bug entries in `BUGS.md` are edited only to change status.
- **Living snapshots** — always reflect *now*; overwrite freely:
  `CURRENT_STATE.md`, `HANDOFF.md`, `TASKS.md`, `ROADMAP.md`, `CONTEXT.json`, `PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`.

Keep entries terse and factual. Every decision and bug-fix must include **why**, not just what.

---

## Memory (`project-brain/memory/`)

The `memory/` folder holds distilled, reusable facts worth remembering across sessions —
scoped to **this project only**.

- One fact per file, kebab-case name, with frontmatter: `name`, `description` (used to judge
  relevance on recall), `metadata.type` (`user` | `feedback` | `project` | `reference`).
- Add a one-line pointer per memory to `memory/MEMORY.md`: `- [Title](file.md) — hook`.
- **On session start,** read `memory/MEMORY.md` first (+ the files it lists) to recall project
  context — before the deep brain files.
- **Never** read another project's `memory/`, and never copy this project's memories into a
  shared/global store. A fact belongs in a global store only if it is useful in *every* project;
  such facts do not live in this folder.
- Memories are point-in-time notes — if one disagrees with current code, the **code wins**;
  correct or delete the memory.

---

## The three you refresh every session end

1. **`HANDOFF.md`** — rewrite the "Where we are right now" and "Do this next" sections so a new
   AI could resume in 2 minutes. This is the most important file.
2. **`CURRENT_STATE.md`** — current focus, % complete, what works, what's broken.
3. **`CONTEXT.json`** — the machine-readable mirror. Keep it valid JSON and in sync with the `.md` files.

---

## ID conventions

- Decisions: `D-001`, `D-002`, … (never reuse a number, even if a decision is later reversed —
  reversal is a *new* decision that references the old one).
- Bugs: `BUG-001`, … (status: `open` | `investigating` | `fixed` | `wontfix`).
- Tasks: `T-001`, … (status tracked by which section they're in).

Cross-reference freely: a CHANGELOG entry can cite `D-004`; a bug-fix can cite `T-012`.

---

## Handoff rule (cross-model)

When the user says they're switching models or running low on tokens:
1. Refresh the three session-end files above.
2. Confirm `CONTEXT.json` is valid JSON.
3. Tell the user: *"Brain is up to date. In the new model, paste: 'Read
   project-brain/HANDOFF.md then CONTEXT.json, then continue.'"*

The receiving AI must, on its first turn: read `HANDOFF.md` → read `CONTEXT.json` → skim the
Deep files relevant to the immediate next step → then act. It must **not** ask the user to
re-explain anything already in the brain.

---

## Self-audit (do this occasionally)

Before a major handoff, verify:
- [ ] Does `CONTEXT.json` match the `.md` files?
- [ ] Are there files in the repo not listed in `CONTEXT.json.files`?
- [ ] Any "in-progress" task that's actually done (or abandoned)?
- [ ] Does `HANDOFF.md`'s "Do this next" reflect the true current edge of the work?
- [ ] Any decision made verbally in chat but never written to `DECISIONS.md`?
