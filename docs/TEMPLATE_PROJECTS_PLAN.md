# Template / Duplicate Projects — Design Doc (t_249)

> **Phase 1 (duplicate) is now planned in `ARCHIVE_AND_DUPLICATE.md`** (t_878). This doc remains the home
> for the parked long-term template vision: marking templates + `{placeholder}` prompting (Phases 2–3).

> Status: **proposal for review.** No code written yet.

## Intent (from the backlog)
> "At the very least a way to **duplicate a project** so I can use it as a temp project. Maybe a way to
> **label a project as a template**. It'd be awesome if I could have fields like **`{book_name}`** that
> **prompt me when I create it**, then all tasks with `{book_name}` in them get replaced with the value I
> input on creation. This would probably be its own screen and workflow. Definitely a big lift but would
> really suit my workflow."

Three escalating capabilities. Recommend shipping in phases so you get value early and the big lift is
optional.

## Architecture fit
Duplication is **pure client-side**: deep-clone the project subtree + its tasks into the store with fresh
ids (`uid()`), push them, autosave persists. No backend/schema work for Phase 1. Marking templates
(Phase 2) adds one persisted column (same migration pattern as `pinned`/`archived`). Placeholders
(Phase 3) are a string-substitution pass + a prompt modal — still client-side.

---

## Phase 1 — Duplicate a project (MVP, no schema change)
A **"Duplicate"** action in `ProjectModal` (edit mode). `store.duplicateProject(p)`:
- Deep-clone the project **and its subprojects** (recurse `childProjects`), each a new `uid('p')`, name
  suffixed `" (copy)"` on the root only, preserving color/glyph/parent/position.
- Clone **all tasks + subtasks** in the subtree with new `uid('t')`, remapping `project_id` and
  `parent_id` to the new ids (keep notes, labels, priority).
- **Reset for reuse:** `done=false`, `completedAt=null` on every cloned task (a fresh project to work
  through). Recurrence/reminders: see decisions.
- Open the new project. Autosave persists.

Reuses: `store.childProjects`, `store.subtasks`, `mk()`/`uid()`, `COLORS`/`GLYPHS`.

## Phase 2 — Mark a project as a template (one flag)
- **Migration `0NN_project_template.sql`:** `ALTER TABLE projects ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;`
  + `state.js` read/write + frontend default (same three-touch pattern).
- Templates live in their own collapsible **"templates" sidebar section** and are **excluded from normal
  views/counts/pickers** (same effective-hide logic as archived projects — share that filter).
- Action: **"New from template"** = Phase-1 duplicate, but the copy is a normal (non-template) project.
- Toggle `is_template` from `ProjectModal`.

## Phase 3 — `{placeholder}` prompting (the big lift)
The "create from template" workflow, on top of Phase 2:
1. **Scan** the template subtree for unique `{token}` patterns (`/\{([a-z0-9_]+)\}/gi`) across project
   names, task titles, and notes. Collect the distinct token list.
2. **Prompt modal** (new `KbForm` screen): one input per token (`book_name → "Dune"`), keyboard-navigable
   (`i` to edit, `j/k` between fields, Enter to create) — mirrors the recurrence sub-pane pattern.
3. **Substitute** every `{token}` with its value throughout the cloned subtree, then create it (Phase-1
   clone with substitution applied). Unfilled tokens left as-is or blanked (decision).

This is the "own screen and workflow" you described; it's additive — Phases 1–2 stand alone without it.

---

## Open decisions (need your call)
1. **Due dates on duplicate.** Absolute dates rarely make sense in a reused/template project. Options:
   (a) drop all due dates, (b) keep as-is, (c) **offset** relative to today (e.g. preserve each task's
   day-gap from the original project's earliest due). Recommendation: **(a) drop** for templates, **(b)
   keep** for a plain duplicate — or make it a checkbox at duplicate time.
2. **Recurrence/reminders on clone.** Keep or strip? Recommendation: keep recurrence (it's relative), drop
   reminders (absolute timestamps).
3. **Scope of "template" filtering.** Reuse the archived-style "effective hide" so templates don't pollute
   views/search/counts — confirm templates should be fully hidden except in their own section.
4. **Placeholder syntax.** `{token}` (recommended, readable) vs. `((token))`/`$token` to avoid clashing
   with real braces in notes. Confirm `{}` is safe for your content.
5. **Where placeholders are scanned.** Titles + notes + project names (recommended) — include notes?
6. **Phasing.** Ship **Phase 1 (duplicate) now**, defer 2–3? Recommendation: yes — Phase 1 covers "temp
   project" immediately; templates + placeholders when you want them.

## Dependencies / synergy
- Phase 2's "hide except in own section" should **share the archived-projects effective-hide filter**
  (`docs/ARCHIVE_PROJECTS_PLAN.md`) — build that generically (`store.isHidden(projectId)` covering both
  `archived` and `is_template`) so views/counts/pickers filter once.

## Out of scope
Cross-account template sharing (that's t_320); template *marketplace*/export (Import/Export doc handles
plain CSV); versioning templates.

## Verification
- Duplicate a multi-level project (subprojects + subtasks) → exact structure copied with new ids, all
  tasks reset to not-done, original untouched; reload confirms persistence.
- (Phase 2) Mark a project template → it leaves normal views/sidebar/counts/pickers, appears under
  "templates"; "New from template" yields a normal working copy.
- (Phase 3) A template with `{book_name}` in a project name + several task titles → create prompts once
  for `book_name`, and every occurrence is substituted in the new project.
