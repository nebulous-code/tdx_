# tdx_ — Design Document

**Product:** `tdx_` — a keyboard-first, terminal-styled personal task manager.
**Status:** Interactive front-end prototype (Vue 3, no build step). Dark mode only.
**Purpose:** A power-user to-do app that fits a developer's mental model — projects as a tree, tasks as queryable records, recurrence as a small reusable syntax, and a command palette as the primary way to get around.

> This prototype was commissioned to "scratch an itch": existing to-do apps don't quite fit, so the goal is a tool shaped around the owner's own workflow rather than a general-audience product.

---

## 1. Original Brief

Verbatim intent captured from the request:

- A to-do list application with **Vue** as the front end.
- Handles **multiple projects with sub-projects**, and **tasks with sub-tasks**.
- **Flat, single-color icons and background colors** to categorize projects.
- **Recurring tasks**, supporting all of:
  - Daily.
  - Multiple repeats per week (e.g. **MWF**, **Sat & Sun**).
  - Weekly as in **every N weeks**.
  - Monthly as in **the Nth day of the month**.
  - Monthly as in **the 1st/2nd/… day-of-week** (1st Monday, 2nd Friday, …).
  - Monthly as in **every N months**.
- **Due dates** and **reminder dates**.
- **Labels** on tasks.
- A **query interface** to find tasks, with the ability to **save a query** and return to it later.
- **Dark mode only**, **developer / terminal** styling.

### Decisions confirmed during kickoff
| Question | Answer |
|---|---|
| Deliverable | A working, clickable Vue prototype with sample data |
| Aesthetic | Hacker terminal — CRT / phosphor glow, scanlines, retro |
| Accent | Amber / orange |
| Primary layout | Command-driven, keyboard-first; command palette is the hub |
| Query UI | **Both** — text query *and* a visual builder that writes the text |
| Saved queries | Pinned "smart views" in the sidebar (like Today / Overdue) |
| Recurrence UI | Guided builder that **writes a syntax string** you can reuse/retype |
| Key screens | Project+subproject tree, task list w/ subtasks, task detail/edit, recurrence editor, query builder + save |
| Platform | Desktop-first for heavy work; responsive for mobile add/remove; eventual PWA |
| Variations | One strong direction (no A/B options) |
| Icons | Monospace / ASCII glyphs |

---

## 2. What the App Does (Feature Summary)

### 2.1 Projects & sub-projects
- Projects form a **tree** of arbitrary depth (projects → sub-projects → …), shown in the sidebar.
- Each project has a **category color** (flat) and an **ASCII glyph** "icon", both user-chosen from curated palettes.
- Rows are collapsible (twist control) and show an **open-task count** that rolls up the subtree.
- Create via the `+` on the section header or on any project row (adds a sub-project); edit/delete via right-click → modal (name, color, glyph). Deleting a project recursively removes its sub-projects and their tasks.

### 2.2 Tasks & sub-tasks
- Tasks belong to a project and may nest into **sub-tasks** (also arbitrary depth in the model; primarily one level in the UI).
- A task row shows: checkbox, title, project chip (color glyph + name), due date (relative), reminder, recurrence (compact), sub-task progress (`done/total`), and label tags.
- **Quick-add** bar at the top of the list; supports inline `#label` capture (`buy milk #errand`). New tasks land in the current project (or a default).
- **Selection model:** one task selected at a time; drives keyboard actions and the detail drawer.
- Completing a task with sub-tasks is independent (sub-tasks tracked separately and shown as progress).

### 2.3 Due dates & reminders
- Each task has an optional **due date** and an optional **reminder date** (native date pickers, themed to the palette).
- Due state is color-coded in the list: upcoming (dim), **today** (amber glow), **overdue** (red). The detail drawer shows a plain-language relative string ("due in 3 days", "overdue by 1 day").

### 2.4 Labels
- Free-form **labels** (e.g. `#urgent`, `#deep-work`, `#bug`). Created on the fly from quick-add or the detail drawer.
- Labels appear as a section in the sidebar; clicking one opens a saved-style view of open tasks with that label.
- Labels are first-class in queries (`label:urgent`).

### 2.5 Recurrence (the syntax engine)
A small, human-readable recurrence **mini-language**. The guided builder writes it; you can also type it by hand and reuse the same string on other tasks.

**Supported forms**
```
daily
every N days
weekly on mon,wed,fri            # multiple repeats per week (MWF, Sat&Sun, …)
every N weeks on mon,wed         # every N weeks, on chosen days
monthly on day 15                # Nth calendar day of the month
every N months on day 15
monthly on 2nd fri               # Nth weekday  (1st/2nd/3rd/4th/last)
every N months on 1st mon
```

**Builder UX**
- Frequency selector: `none / daily / weekly / monthly`.
- Reveals only the relevant controls (weekday chips + presets MWF / Tu·Th / Sat·Sun / weekdays; interval steppers; monthly mode toggle "on a date" vs "on a weekday" with ordinal + weekday selects).
- Live, editable **syntax field** (echoed in cyan) + a plain-language **summary** + the **next 3 occurrences** computed from the engine.
- **Reusability:** the emitted string is plain text, so copying it onto another task reproduces the schedule exactly.

**Behavior**
- Completing a recurring task **spawns the next occurrence** automatically (next due date computed by the engine; the reminder is shifted to preserve its offset from the due date).

> Engine lives in `recurrence.js` as pure functions (`parse`, `stringify`, `summary`, `compact`, `matches`, `nextOccurrences`, `next`) — directly liftable into the production app/back end.

### 2.6 Query interface (text + builder)
A query language for finding tasks, with a visual builder that **writes the same text** (the two stay in sync).

**Grammar** (space-separated terms, implicit AND; comma = OR within a field; `-` negates):
```
project:work            # matches a project OR any of its sub-projects
label:urgent            # label:urgent,bug  → OR within field
status:open|done|overdue|today
due:today|tomorrow|overdue|week|none|set|<7d|>7d|<=3d|=0d ...
reminder:today|none|set|overdue|<Nd ...
recurring:true|false
is:subtask|task|recurring        has:subtasks|label|due
"free text"  or  bareword        # title/notes contains
```
- **Text bar** with `?` prompt for typing queries directly.
- **Visual builder** (toggleable panel): chip groups for status, due, labels, project, and flags; clicking chips edits the query string. Exclusive groups (status/due/project/recurring) replace; additive groups (labels/flags) toggle.

> Engine lives in `query.js` (`parse`, `evaluate`, `run`, `build`) — also pure and liftable.

### 2.7 Saved queries → smart views
- Any query can be **saved as a smart view**, pinned in the sidebar `views` section.
- Ships with system views: **Today, Overdue, This week, Recurring, No date**, plus example saved views (Urgent, Quick wins).
- Each view shows a live count. User-created views can be deleted (right-click). Selecting a view runs its query.

### 2.8 Command palette & keyboard model
- **`⌘K` / `Ctrl+K`** opens a fuzzy-searchable palette — the central navigation/action hub. Grouped into Actions, Views, Projects, Sort. Arrow-key navigation, Enter to run.
- **Global shortcuts:** `j/k` move selection · `x`/Space toggle done · `e`/Enter open detail · `n` new task · `/` focus query · `c` toggle completed · `Esc` closes palette → modal → drawer.

### 2.9 List controls
- Toggle **show/hide completed**; **sort** cycles through due / created / title / project.
- If a sub-task matches a query but its parent doesn't, the parent is surfaced so context is preserved.

### 2.10 Persistence & responsiveness
- State (projects, tasks, labels, saved queries) **persists to `localStorage`** (debounced) and rehydrates on load.
- Responsive: desktop three-zone shell; on narrow screens the sidebar becomes an off-canvas drawer and the detail panel goes full-width — tuned for quick add/remove on mobile.

---

## 3. Architecture (prototype)

| File | Responsibility |
|---|---|
| `index.html` | App shell, top/status bars, global keyboard handler, persistence, component registration |
| `styles.css` | Full CRT/amber design system (see STYLE_GUIDE.md) |
| `data.js` | Reactive store + sample data; all mutations (add/toggle/delete, save query, recurrence spawn) and derived helpers (`visibleRoots`, counts) |
| `recurrence.js` | `window.Rec` — recurrence parse / stringify / summary / compact / occurrence math |
| `query.js` | `window.Q` — query parse / evaluate / run / build |
| `sidebar.js` | Smart-view list + recursive project tree (`TreeRow`) |
| `tasklist.js` | Quick-add, list header/controls, recursive `TaskRow` |
| `recurrence-builder.js` | Guided recurrence editor (emits syntax string) |
| `task-detail.js` | Detail/edit drawer (project, status, due, reminder, labels, recurrence, notes, sub-tasks) |
| `query-bar.js` | Text query input + visual builder panel |
| `command-palette.js` | `⌘K` palette with fuzzy filter |
| `modals.js` | Project create/edit modal, save-query modal |

**Data model (essentials)**
```
Project  { id, parentId, name, color, glyph, collapsed }
Task     { id, projectId, parentId, title, done, due, reminder,
           labels[], recurrence (syntax string), notes, createdAt, completedAt }
Label    { id, name }
SavedView{ id, name, glyph, query, system }
```

---

## 4. Explicitly Out of Scope (prototype)

These were **not** requested or are intentionally deferred — flagged so the coding agent doesn't assume them:

- No back end / sync / accounts (local `localStorage` only).
- No real notifications/alarms — reminder is a **date field**, not a delivery mechanism yet.
- Query logic is **AND of terms** (with OR only inside a single field via commas); no nested `OR` groups or parentheses.
- Saved views are run-only; no inline editing of a saved view's query (re-save to update).
- No drag-to-reorder, no calendar/agenda grid view, no per-label colors (labels are monochrome).
- Sub-tasks are modeled to arbitrary depth but the UI focuses on one level.

---

## 5. Suggested Next Steps

1. **Wire to a back end / PWA shell** — manifest + service worker; swap `localStorage` for a synced store. (Already seeded as a task in the app.)
2. **Reminders that fire** — turn reminder dates into actual local notifications.
3. **Query OR-groups** — extend `query.js` grammar with `|` / parentheses; update the builder.
4. **Editable saved views** + reorderable sidebar.
5. **Agenda / calendar view** driven by the recurrence engine's occurrence stream.
6. **Per-label color** and label management UI.
7. **Drag-and-drop** reordering and re-parenting for projects and tasks.

---

*Companion document: `STYLE_GUIDE.md` (visual system, tokens, components, keyboard model).*
