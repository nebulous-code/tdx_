# tdx_ Backlog — Reconciliation

Reconciled against the **tdx** project tasks (`p_146`) in the live **prod** DB
(`~/docker/tdx/data/tdx.db`, read-only — DB is source of truth).
Current: **55 done / 8 open.**

## Shipped since the last sync (all merged to main)
The entire quality-of-life run and both project epics are **done**:
- QOL: t_549, t_577, t_580, t_581, t_590, t_653, t_681, t_747, t_777, t_778, t_793, t_796, t_863.
- Epics: **t_217 (soft-delete projects)** and **t_878 (duplicate projects)** — see
  `docs/ARCHIVE_AND_DUPLICATE.md`. Soft delete is server-protected (rows kept `archived=1`, recovery is
  DB-only, no in-app restore); duplicate deep-clones with the cancel/no/yes subproject prompt.

> **Deploy note:** prod's `tasks`/`projects` did **not** yet have the `archived` column at last check —
> migration 013 applies on the next Watchtower run (or manual: `cd ~/docker/tdx && docker compose pull tdx && docker compose up -d tdx`).

---

## The 8 open tasks (your read is right — mostly epics / under-defined)

### Actionable, already designed
- **t_224 — Data Export/Import (CSV)** `#feature` → `docs/DATA_IMPORT_EXPORT_PLAN.md`. The most
  build-ready of the open set: defined scope + plan. One thing to fold in now that soft-delete exists:
  **decide whether export/import touches `archived` rows** (the doc flags this as open).

### Well-described but design-first
- **t_621 — rethink the filter's "Status" option** `#bug`. Suspect most Status concepts collapse into
  Due (`>0d`, overdue, etc.). Needs a model decision before code — no doc yet.
- **t_254 — Duration estimate field** `#feature`. Same shape as priority (column + `state.js` round-trip +
  detail control + `dur:` token + sort field). Only open call: **units** (hours vs number+unit vs Fibonacci).
  No standalone doc.

### Epics (parked / far off)
- **t_249 — Template projects** `#epic` → `docs/TEMPLATE_PROJECTS_PLAN.md`. **Phase 1 (duplicate) shipped;**
  what remains is mark-as-template + `{placeholder}` prompting (Phases 2–3), parked.
- **t_422 — Attachments on a task** `#feature`. Needs blob storage (bind-mounted volume + upload/download
  endpoints + per-user scoping) — the snapshot can't carry binaries. Own design doc not yet written.
- **t_320 — Multi-account project sharing** `#epic`. Ownership/permissions on the multi-tenant model.
  (Backlog previously referenced a `SHARED_SCHEMA_PLAN.md` — that doc does **not** exist yet.)
- **t_867 — Project health check row** `#epic`. A row above the new-task field showing a project's
  "health" (tasks missing due dates / tags / priority), ideally configurable per project. **No doc — this
  is the one open task with zero write-up on our side (see reconciliation gap below).**
- **t_246 — Kanban board** `#epic`. Alternate project view; your note still says "probably not." Parked.

---

## Reconciliation gaps (prod ↔ our docs)

**Prod task with no doc coverage (the only real gap):**
- **t_867 (project health check)** — captured here for the first time; it post-dates the design docs.
  If you want to pursue it, it's mostly client-side (compute per-project completeness stats over
  `store.tasks`) plus a config flag — a future small/medium, not an epic in practice.

**Ideas written in our docs but not tracked as prod tasks** (all *intentionally* deferred — nothing lost,
just noting in case you want any promoted to tasks):
- **Soft-delete recovery/purge tooling** (`ARCHIVE_AND_DUPLICATE.md` out-of-scope): you chose no in-app
  restore; a future "recovery view" is just a `WHERE archived=1` query, and a hard-delete/purge tool is
  optional. Not a task today.
- **Offline write outbox (Phase 2)** (`BACKEND_PLAN.md`): deferred by your call ("offline defer is fine").
- **Backup polish** (`BACKUP_DESIGN.md` §15): in-app failure banner + backup-now progress feedback — both
  deferred; external alarm covers failures for now.

**Stale reference:** `t_320` mentions `docs/SHARED_SCHEMA_PLAN.md`, which was never written.

---

## Reusable building blocks (still current)
- **Snapshot persistence.** `state.js writeState` re-inserts the whole per-user dataset from one client
  snapshot, so most features are **pure client-side** (mutate the store → 300 ms autosave). Backend work
  is only needed for (a) a **persisted column** (migration + `state.js` read/write + frontend default), or
  (b) **binary storage / a server endpoint** the snapshot can't carry (attachments; the soft-delete
  mutations). Soft-deletes go through dedicated endpoints (`/api/projects|tasks/:id/delete`) and re-hydrate.
- **Tasks/projects** now carry `position` (manual order) and `archived` (soft delete); `readState`
  returns `seq` (id high-water mark incl. archived) so new ids can't collide.
- **`KbForm`** (`frontend/js/kbform.js`) — keyboard framework for every modal + the recurrence sub-pane.
- **Query/visibility:** `query.js` `Q.run` + `store.visibleRoots()` is the single choke point for list,
  `j/k`, counts, empty state.
- App-styled dialogs: `store.askConfirm` (yes/no) and `store.askChoice` (cancel/no/yes); edit modals in
  `modals.js`.
