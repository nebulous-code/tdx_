# Data Import / Export (CSV) — Design Doc (t_224)

> Status: **proposal for review.** No code written yet.

## Intent (from the backlog)
> Export/import data as CSV. **Projects** export from the project edit screen; **all data** exports from
> the account screen. Row shape: **Project, Parent Project, Task Title, Description, Labels, Due Date**.
> **Reminders and Recurrence are not supported.** Multiple labels are **semicolon-separated** (so they
> don't clash with CSV commas). Imports should be **idempotent** — a task of the same name is *updated*,
> with a **warning** that it exists and will be updated. Import lives on both the account screen and the
> project screen. **Project-scoped import:** Project/Parent columns are optional/nullable; if a Project
> name is given that doesn't match the target project, **reject with an error**. **Account-scoped import:**
> new projects are created after a **warning listing the projects (and parents)** to be created, each with
> a **randomly chosen color and icon**.

## Architecture fit — fully client-side
Because persistence is a whole-store snapshot, both directions are **frontend-only**: export serializes
the store to a CSV file (browser download); import parses a CSV, upserts into the reactive store, and the
existing 300 ms autosave persists it. **No backend route, no schema change.** (Labels are account-level
already; new ones created via `store.addLabel`.)

## CSV format
- Header row, exact columns: `Project,Parent Project,Task Title,Description,Labels,Due Date`.
- **RFC-4180 quoting** (wrap fields containing `,"`/newline in double quotes, escape `"`→`""`) so titles
  and descriptions with commas survive. A small `csv.js` util: `toCSV(rows)` + `parseCSV(text)`.
- `Labels` = semicolon-separated label names (e.g. `bug;urgent`).
- `Due Date` = `YYYY-MM-DD` (matches the stored `due`); blank if none.
- `Description` maps to the task `notes` field.

## Export
- **Per-project** (`ProjectModal`, edit mode → "Export CSV"): rows for that project's tasks. `Project` =
  the project name, `Parent Project` = its parent's name (blank if top-level).
- **Account-wide** (`account-screen.js` → "Export all"): every project's tasks, Project/Parent populated
  per row.
- Download via a Blob + temporary `<a download>` (no server round-trip).

## Import
1. **File pick** (account screen or project modal) → read text → `parseCSV`.
2. **Build a plan, don't apply yet.** Walk rows and classify against the current store:
   - task **update** (same Project + Title already exists) — collect for the warning,
   - task **create**,
   - **new project** needed (account-scope only) — collect with its parent for the warning,
   - **error** rows (see validation).
3. **Confirmation summary dialog** (`askConfirm`-style, richer): "N create, M update, K new projects
   (list with parents), E errors." Nothing mutates until the user confirms.
4. **Apply:** create new projects (random `COLORS`/`GLYPHS` pick), upsert tasks (update notes/labels/due
   on match, else `store.addTask`), create missing labels. Autosave persists.

### Idempotent upsert key
Match by **(project, task title)** case-insensitively. On match → update Description, Labels, Due (the
three data columns); leave untouched fields (priority, recurrence, reminder, subtasks) as-is. This makes
re-importing the same file a no-op after the first run.

### Scope rules
- **Project-scoped import** (from `ProjectModal`): rows apply to *that* project. `Project`/`Parent`
  columns are optional; **if `Project` is present and doesn't match the target project's name → reject the
  import with an error** (guards against pasting the wrong file). Rows with blank Project are assumed to
  belong to the target.
- **Account-scoped import** (from account screen): `Project` (and `Parent Project`) drive placement.
  Unknown projects are **created** (after the warning), parented by `Parent Project` (created too if
  missing), each with a random color + glyph.

## Open decisions (need your call)
1. **Subtasks.** The agreed columns have **no "Parent Task" column**, so subtask nesting can't round-trip.
   Options: (a) export only root tasks (subtasks omitted) — lossy but matches the column list; (b) export
   all tasks flat, and on import they become **top-level** tasks in the project (nesting lost);
   (c) add a 7th `Parent Task` column to preserve hierarchy. **Recommendation: (c)** if you care about
   checklists surviving a round-trip; otherwise (a). Your call.
2. **Duplicate titles within a project.** If two tasks share a name, "update by title" is ambiguous.
   Recommendation: update the *first* match and warn; or skip-with-warning. Pick one.
3. **Done/priority columns.** Not in your shape. Confirm export omits them (and import never changes
   done/priority). Recommendation: omit, as specified.
4. **Date format / locale.** Lock to `YYYY-MM-DD` (recommended) vs. accept locale dates on import.
5. **Label name vs. slug.** Labels match by name; confirm case-insensitive match + create-if-missing.

## Out of scope
Reminders, recurrence (explicitly excluded); attachments; JSON/full-fidelity backup (that's the DB
backup feature, t_321); merging across accounts.

## Verification
- Round-trip: export a project → re-import the unchanged file → **zero** changes (idempotent).
- Edit a row's Description/Labels/Due in the CSV → re-import → only those fields update; the warning lists
  the updated task(s).
- Account import with a brand-new `Project`/`Parent Project` → summary lists the projects to be created;
  on confirm they appear with a random color/glyph and the tasks land under them.
- Project-scoped import with a mismatched `Project` value → rejected with a clear error, nothing mutated.
- Labels with `;` split correctly; titles/descriptions containing commas survive quoting.
