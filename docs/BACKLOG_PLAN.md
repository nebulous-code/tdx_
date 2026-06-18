# tdx_ Backlog — Reconciliation

Reconciled against the **tdx** project tasks (`p_146`) in the live **prod** DB (`~/docker/tdx/data/tdx.db`, read-only — DB is source of truth). Current: **55 done / 9 open.**

## Shipped / built since the last sync
The entire quality-of-life run and both project epics are **done**:
- QOL: t_549, t_577, t_580, t_581, t_590, t_653, t_681, t_747, t_777, t_778, t_793, t_796, t_863.
- Epics: **t_217 (soft-delete projects)** and **t_878 (duplicate projects)** — see `docs/ARCHIVE_AND_DUPLICATE.md`. Soft delete is server-protected (rows kept `archived=1`, recovery is DB-only, no in-app restore); duplicate deep-clones with the cancel/no/yes subproject prompt.
- **t_254 (Size / Fibonacci field)** — **built, not yet deployed** (staged on `dev`): per-task Size (0/none, 1·2·3·5·8·13) behind an account "sizing" toggle, with a Σ row badge and a size sort. **Mark t_254 done once it deploys.**

> **Deploy state (3 layers right now):** - **prod** is on an older image — schema has **no `archived`/`size` columns yet**, so archive/dupe is **not live on prod** despite being on `main`. - **`main` = `0715c26`** carries archive/dupe (migration 013). Deploys on the next Watchtower run, or manually: `cd ~/docker/tdx && docker compose pull tdx && docker compose up -d tdx`. - **`dev`** has the Size work (migration 014) **staged, uncommitted** — commit → push → fast-forward `main` → deploy, as usual.

---

## The 9 open tasks (your read is right — mostly epics / under-defined)

### Built, awaiting deploy + close
- **t_254 — Size / Fibonacci field** `#feature`. **Done in code (staged on `dev`)** — close it in prod once the Size deploy lands. (Implemented as "Size", not literal time/duration, per your call.)

### Actionable, already designed
- **t_224 — Data Export/Import (CSV)** `#feature` → `docs/DATA_IMPORT_EXPORT_PLAN.md`. The most build-ready of the open set: defined scope + plan. One thing to fold in now that soft-delete exists: **decide whether export/import touches `archived` rows** (the doc flags this as open).
- **t_880 — Archive Project Restore** `#feature` (new). A recovery screen (reachable from the account screen) listing soft-deleted projects so you can revive one. The data already supports it — restore is just flipping `archived=0` over a project subtree (the inverse of the delete mutation), and a read that can see `archived=1` rows. Small/medium; it's the natural follow-on to soft delete. *(Captured in `docs/ARCHIVE_AND_DUPLICATE.md`.)*

### Well-described but design-first
- **t_621 — rethink the filter's "Status" option** `#bug` → `docs/STATUS_FILTER_RETHINK.md`. Verdict: Status is redundant with **Due + the completed toggle**. Recommend removing the Status builder section (keep the `status:` token so saved views still work), optionally making the completed toggle 3-state (hide/all/done-only) so nothing is lost. Decision pending.

### Epics (parked / far off)
- **t_249 — Template projects** `#epic` → `docs/TEMPLATE_PROJECTS_PLAN.md`. **Phase 1 (duplicate) shipped;** what remains is mark-as-template + `{placeholder}` prompting (Phases 2–3), parked.
- **t_422 — Attachments on a task** `#feature`. Needs blob storage (bind-mounted volume + upload/download endpoints + per-user scoping) — the snapshot can't carry binaries. Own design doc not yet written.
- **t_320 — Multi-account project sharing** `#epic`. Ownership/permissions on the multi-tenant model. (Backlog previously referenced a `SHARED_SCHEMA_PLAN.md` — that doc does **not** exist yet.)
- **t_867 — Project health check row** `#epic` → `docs/PROJECT_HEALTH_PLAN.md`. A row above the new-task field showing a project's "health" (open tasks missing due / tag / priority / size), configurable. Mostly client-side; recommended v1 is a global toggle + read-only counts. (Not really an epic in practice — small/medium.)
- **t_246 — Kanban board** `#epic`. Alternate project view; your note still says "probably not." Parked.

---

## Reconciliation gaps (prod ↔ our docs)

**Now resolved (both prior gaps closed):**
- **t_867 (project health check)** now has a write-up → `docs/PROJECT_HEALTH_PLAN.md`.
- The "recovery view" idea from `ARCHIVE_AND_DUPLICATE.md` is now a real prod task (**t_880**).
- Net: **every open prod task now has doc coverage.** (A hard-delete/purge tool is still optional / untracked.)

**Ideas written in our docs but not tracked as prod tasks** (all *intentionally* deferred — nothing lost, just noting in case you want any promoted to tasks):
- **Offline write outbox (Phase 2)** (`BACKEND_PLAN.md`): deferred by your call ("offline defer is fine").
- **Backup polish** (`BACKUP_DESIGN.md` §15): in-app failure banner + backup-now progress feedback — both deferred; external alarm covers failures for now.

**Stale reference:** `t_320` mentions `docs/SHARED_SCHEMA_PLAN.md`, which was never written.

---

## Reusable building blocks (still current)
- **Snapshot persistence.** `state.js writeState` re-inserts the whole per-user dataset from one client snapshot, so most features are **pure client-side** (mutate the store → 300 ms autosave). Backend work is only needed for (a) a **persisted column** (migration + `state.js` read/write + frontend default), or (b) **binary storage / a server endpoint** the snapshot can't carry (attachments; the soft-delete mutations). Soft-deletes go through dedicated endpoints (`/api/projects|tasks/:id/delete`) and re-hydrate.
- **Tasks/projects** now carry `position` (manual order) and `archived` (soft delete); `readState` returns `seq` (id high-water mark incl. archived) so new ids can't collide.
- **`KbForm`** (`frontend/js/kbform.js`) — keyboard framework for every modal + the recurrence sub-pane.
- **Query/visibility:** `query.js` `Q.run` + `store.visibleRoots()` is the single choke point for list, `j/k`, counts, empty state.
- App-styled dialogs: `store.askConfirm` (yes/no) and `store.askChoice` (cancel/no/yes); edit modals in `modals.js`.
