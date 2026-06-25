# 2D — Frontend app-shell (D2 phase 2d)

> Living design doc. Builds on `PLATFORM_ARCHITECTURE.md` (§5 query, §10 frontend shell) and `BACKEND_REDESIGN_TODO.md`. **Open decisions are at the bottom — those gate the build.**

## Context
2a (events), 2b (links graph), 2c (file-backed notes) built the whole **data spine** server-side. The frontend, though, is still the original monolithic `index.html` SPA with the calendar (2a) and notes (2c) screens **bolted in** — we always called those throwaway-relocatable. 2d is where the frontend gets rebuilt to match the backend's shape: a shell + router + lazy route modules, one unified query engine driving every screen, and proper homes for cross-links and notes rendering. It's the **largest single piece** of D2, so it's sliced (below) and each slice ships independently.

This is structure, not polish. The broad UI/UX pass is **2e** by design — polishing the bolted-in screens now would be thrown away when 2d rebuilds them.

## Goals (what 2d delivers)
- **App shell + router + lazy modules.** Split the monolith into a shell that hosts lazy-loaded route modules — `/tasks`, `/events`, `/notes` — with bookmarkable URLs (§10).
- **Deep-nav drawer.** A left-most section drawer (Tasks / Events / Notes …) that switches modules — **replaces the `cal` / `notes` top-right toggles**. The existing project/label nav becomes the Tasks section's sub-nav. *(your dump #6)*
- **Rebuild calendar → the real `/events` module**, built keyboard-capable from the start, including **hjkl day navigation**. *(your dump #1)*
- **Rebuild notes → the real `/notes` module**, with **rendered markdown** (not just a raw textarea) and **live `tdx-query` embeds** (the bit we explicitly deferred from 2c). *(your dump #5)*
- **Unified query engine.** Extend `POST /api/query` with a `type:task,event,note` predicate so the task list, the calendar grid, the notes list, and search all run through **one** engine (§5) — `query.ts`/`Q` already exists for tasks; this generalizes it to return mixed entities.
- **Cross-link UI.** Proper link chips + "open the linked X," and **link-by-name insertion** via a tab-completing picker so links never require typing a UUID. *(your dump #4)*
- **Keyboard + nav model.** `N` (Shift-N) toggles the **deep-nav drawer** (switch apps); `n` toggles the **current app's** nav — today that's the Tasks project/label sidebar, and `n` becomes *app-scoped* so Events/Notes can own their own nav later. Notes list is **`j`/`k` navigable** (1-D list). The **notes editor uses vim-like modes** — *insert* = raw markdown text, *normal* = rendered — never side-by-side; a mouse/touch toggle covers non-keyboard users. **Enter saves** (with the `↵` glyph) across every save UI.

## Non-goals / parked (ordering: 2d → 2e → per-app navs → notes tags → 2f)
- **Broad UI/UX polish + the full keyboard/accessibility sweep → 2e.** The *Enter-to-save + `↵`* convention gets adopted globally during 2d; the sweep that catches what we miss is 2e.
- **Per-app secondary navs for Events/Notes → after 2e, before notes-tags.** 2d ships the deep-nav drawer (`N`) and keeps the Tasks nav (`n`); Events/Notes get their own `n`-toggled navs in a later slice. Tags likely live in the Notes nav, so the nav comes first.
- **Notes tags → after the per-app navs, before 2f.** Model is decided (reuse `labels`, persisted in the note's frontmatter header — see Decided #4); it's a small slice of its own, scheduled here.
- **CLI / MCP / RAG → 2f.**

## Build order (independently shippable slices, like 2c)
1. **Shell + router + deep-nav drawer.** Move today's screens behind routes with *no behavior change* — just relocate calendar/notes/tasks under the shell and swap the topbar toggles for the drawer. Lowest-risk first.
2. **Unified query.** Server: generalize `Q`/`POST /api/query` to `type:` + mixed-entity results (parity-tested like the original port). Client: one data path the modules share.
3. **`/events` module rebuild.** The proper events module off the shell + the unified query, keyboard-capable (hjkl day nav).
4. **`/notes` module rebuild.** Markdown rendering + `tdx-query` embeds + the link-by-name picker.
5. **Cross-link UI.** Chips / open-linked across modules, replacing the 2b minimal pickers.

## Your UX dump — sorted
| # | Item | Lands in | Notes |
|---|------|----------|-------|
| 6 | Deep-nav drawer (Tasks/Events/Notes), replaces cal/notes buttons | **2d slice 1** | This *is* the app-shell nav. |
| 1 | Calendar hjkl day navigation | **2d slice 3** | Built into the events-module rebuild, not bolted onto the throwaway calendar. |
| 5 | Render markdown in notes (not just raw) | **2d slice 4** | The "real editor"; `tdx-query` embeds render here too. |
| 4 | Link by name, not `task:id`/`event:id` (UUIDs are unmemorable) | **2d slice 5** | Real fix is a *picker* so you never type an id — see Decision 2. |
| 3 | Notes get tags, shown on the note list/detail (title left, labels under) | **after 2e, own slice** | Model decided: reuse `labels`, stored in frontmatter header — Decided #4. |
| 2 | All save UIs use Enter + show the `↵` symbol | **adopt in 2d, sweep in 2e** | Task/event editors already do; notes editor is the gap. |
| + | `N` = deep-nav drawer · `n` = current app's nav (scoped) | **2d slice 1** | Per-app Events/Notes navs come after 2e. |
| + | Notes list `j`/`k` nav · notes editor vim insert/normal modes | **2d slice 4** | High-level keyboard wins (peer to events hjkl); no exhaustive shortcuts this pass. |

## Decided
- **Router/shell.** Hand-rolled tiny hash router + lazy-loaded module scripts (no router lib, no build step). Lazy-loading happens regardless; real URLs (refresh-stays-put, back/forward between apps) are in.
- **Link-by-name (cross-links).** Picker inserts an aliased link `[[task:<id>|Buy groceries]]` — id resolves (stable across renames), name displays, you never type the id. Picker **tab-completes** task/event names (reuse the task tag-completion UX). Raw hand-authored `[[task:Buy groceries]]` resolves by title as a fallback.
- **Markdown renderer.** Vendored markdown lib (no hand-roll), extensible for custom syntax (`=highlight=`, `- [ ]`/`- [x]` checkboxes). Editing = **vim modes** (insert = raw text, normal = rendered) + a mouse/touch toggle; **no side-by-side** (hard no). `tdx-query` blocks render as a live list in normal mode.
- **Notes tags model.** Reuse the **`labels`** system across all apps, persisted in the note's **frontmatter header** (`labels: #label_1 #label_2`, alongside `id:`) so they sync file↔DB — not inline `#tags` in the body. For search/filter + shown on the note list/detail (title left, labels beneath, like tasks). Scheduled after 2e (after the per-app navs), before 2f.
- **Deep-nav drawer shape.** Collapsible; **icon buttons** for Tasks/Events/Notes only (account/settings/search stay put); opening it pushes the nav right + shrinks the detail (like the nav does to details today); mobile via a `>` in the bottom-left on narrow screens. **Icons: Lucide** — `square-check-big` (Tasks), `calendar-days` (Events), `notebook-pen` (Notes) — inlined as SVG, tinted via `currentColor` → `var(--amber)` + the CRT glow.
- **Keyboard scope (this pass).** High-level only: events hjkl + notes insert/normal + the `N`/`n` nav toggles. Exhaustive per-modal shortcuts wait for 2e.
- **Enter-to-save.** Adopt globally during 2d; the 2e sweep catches stragglers.

## Open threads (one conversation at a time)
- **Long-term link ids.** Whether to give tasks human-readable ids (`t_001`, like the old scheme) and/or use project-scoped links `[[task:<project>|<name>]]` instead of injecting a UUID. Out of scope for 2d (we ship the aliased-picker now); a future conversation.
