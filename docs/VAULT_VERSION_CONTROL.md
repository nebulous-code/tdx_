# Vault version control — design

In-app history, restore, archive, and permanent-delete for notes, built on the git history the vault backup already lays down. This is its own initiative on its own branch — **not** part of the Events & Notes release. The point of committing the vault to git from day one (`VAULT_BACKUP.md`) was that this history silently accrues, so this work is "expose and manage history that already exists," not "build a versioning system."

## What the substrate already gives us

`server/src/vault-git.ts` snapshots the whole vault into a separate git dir (`<backup_config.dir>/vault.git`, detached work-tree over `VAULT_DIR`) on a debounced commit-on-save (`createVaultGit().scheduleSnapshot()`, 5s) and on the scheduled backup, both gated by the single `backup_config.enabled` switch and serialized by a module mutex. Commits are whole-vault snapshots (`vault snapshot <ts> — N changed (reason)`), attributed to the sole user. So every note file already has linear history; a `git log`/`git show` over its path is its version list.

Two facts shape the whole design:

- **A note's identity is its frontmatter `id`, not its path.** `scanFile` (services/notes.ts) reads a file, writes back a frontmatter id if missing, and upserts the DB row by that id — so renames/moves resolve to the same note. Paths in git are `<owner>/<relPath>` (filename = title, Obsidian-style).
- **The DB is a rebuildable shadow.** `scanFile` (one file) and `scanVault` (whole tree, incremental or full) reconcile rows + FTS + link edges from disk. This is exactly what a restore needs to call after it writes an old version back, and `POST /api/notes/sync` already exposes the whole-vault version of it.

Because commits are whole-vault snapshots, a note's "versions" are the subset of snapshot commits that touched its file — each such commit is a restore point. Version granularity is therefore the 5s save-burst, not per-keystroke, which is the right grain for restore points. In practice a save-burst touches the one note you're editing (plus any images added in the same burst), so a per-note history reads clean.

## Feature A — in-app version history & restore (the core)

Let a user see and roll back a note's past states from inside the notes app, never dropping to the git CLI.

**Read path (new helpers in `vault-git.ts`, reusing the existing `runGit`):**

- `history(relPath)` → `git log --follow --format=… -- <owner>/<relPath>`: an ordered list of `{ ref, timestamp, message }`. `--follow` carries history across renames/moves.
- `versionText(ref, relPath)` → `git show <ref>:<owner>/<relPath>`: the note body as of that commit.
- `restore(relPath, ref)` → `versionText` → **inject the note's current frontmatter id into the restored text** (so a pre-id-injection version can't mint a *new* id and duplicate the note) → write the file → `scanFile(db, owner, relPath)` to reconcile the DB shadow/FTS/links → `scheduleSnapshot()`. The restore lands as a **new commit on top** — non-destructive and itself reversible. (This is the round-trip already covered by `vault-git.test.ts`.)

**Endpoints (routes/notes.ts):**

- `GET /api/notes/:id/history` → the version list (resolve id → current relPath from the DB row, then `history`).
- `GET /api/notes/:id/history/:ref` → `{ text, diff }` for one version (diff against current, computed in JS or via `git diff`).
- `POST /api/notes/:id/restore` `{ ref }` → performs the restore, returns the refreshed note.

**UI:** an **inline per-note history panel** reachable from the note detail drawer — a list of versions with relative timestamps, a **rendered-markdown diff** against the current text, and a Restore action per version. A per-note panel (not a global browser) is the right surface: `git log -- <path>` isolates a note's own versions even though the underlying commits are whole-vault snapshots.

**Scope:** notes-only. Tasks and events are DB-only and not in git; they stay on the 7-day rolling DB backup. Restore rolls back the note's **markdown text**; embedded images/attachments are a separate concern that rides on the (unbuilt) pictures-in-notes work — see Deferred details.

## Feature B — archive & permanent delete

Deletion is **archive by default** — recoverable. Archive is the existing soft-delete (the notes domain's `tombstoned` flag) surfaced in a UI: archiving removes the file from the vault and marks the row tombstoned, but its full history stays in git, so it's always restorable (restore = un-tombstone + write the last committed version back). Every note gets an **Archive** action (and, once images land, every attachment does too). Permanent delete is the escape hatch that actually scrubs history: **Permanent delete** is the separate, high-friction escape hatch for the two cases where history *persisting* is the problem:

1. **Space** — a large binary (a big PDF, a pile of images) is pinned in history; deleting the file doesn't reclaim the space until its versions are purged and `git gc` runs.
2. **Sensitive content** — an SSN, bank details, or an actual secret pasted into a note. A soft archive leaves it in history forever; only a hard delete scrubs it.

**Where it lives:** archived items are reviewed on a dedicated **archive screen under a Notes settings tab on the account screen** — a list of everything archived-but-not-yet-purged, each with **Restore** and **Delete permanently** (type-the-note-name to confirm, matching the planned project hard-delete). The per-item Archive action lives on the note (and attachment) itself; the account screen is where you review what's archived and permanently purge it. (Exact screen layout and confirmation friction fill in once the basic UI exists.)

**Under the hood:** permanent delete is a purge-by-path across all history via **`git filter-repo`** — the extra binary in the image is an acceptable cost, and the alternative (`git filter-branch`) is deprecated and slow — followed by a repack/`gc`, with the commit loop **paused** for the duration (extend the existing mutex so no snapshot races the rewrite). It supports both **whole-note purge** and **single-attachment purge** (e.g. you uploaded the wrong image and want just that binary gone while keeping the note).

**Scope:** the purge operates on the **local `vault.git` only**. Remote/offsite copies are explicitly not our concern — no remote rewrite, no offsite-copy warnings. History rewrite changes commit hashes after the purge point, which is fine for a private, single-writer repo as long as the commit loop is paused.

## Feature C — configurable ignore rules

The substrate ships a fixed ignore (tool/OS cruft only, written to `<gitDir>/info/exclude` at init: `.obsidian/`, `.DS_Store`, `*.tmp`, `*.swp`, `Thumbs.db`). Later, let a power user configure what the backup ignores — exclude a scratch folder, skip files over a size threshold — to keep history lean **proactively** rather than reaching for permanent-delete after bloat is committed. Rules are globs and/or a size threshold. This config lives on the **same Notes settings tab** (account screen) as the archive review. The UI must **preview what a rule would exclude** before it takes effect, because a bad ignore that silently drops real notes is worse than no config.

## Non-goals

- **Task/event version history** — tasks and events are DB-only and have their own structure; the 7-day rolling backup is sufficient. We are not snapshotting the DB into git to give them month-old history. If that ever changes, the path is "commit a DB dump into the vault repo too," but it is not planned.
- **Branching / merging / collaboration** — the vault repo stays linear and single-writer. Multi-user note collaboration is a separate initiative.
- **Productized offsite sync** — pushing the vault repo to a remote stays a manual advanced-user step for now.

## Phasing & deferred details

- **Phase 1 — Feature A** (inline per-note history + restore): a thin layer over the existing git primitives; no new storage; note-text only.
- **Phase 2 — Feature B** (archive-by-default, plus the account-screen Notes-settings tab for reviewing archived items and permanently purging them).
- **Phase 3 — Feature C** (configurable ignore rules on the same tab).
- **Deferred to build time:** the archive/settings screen layout and confirmation friction; the ignore-rule syntax and preview UX; and everything attachment-specific — **attachment-level purge** and **image-aware restore** — which presupposes notes can carry images (the unbuilt **t_0474 — Pictures in Notes**). Until that lands, history/restore/archive/purge are note-text only.
- **Build it forward-compatible, not attachment-aware yet.** Deferring attachments must not box us in. The git primitives (`history`/`versionText`/`restore`/purge) are already **path-generic** — they operate on any `<owner>/<relPath>`, so a `.png` extends them with no rewrite; keep them that way rather than hardcoding `.md`. Model a note's restore point as "a note *and its associated files* at commit `<ref>`" even while the file set is only ever the one `.md` today, so image-aware restore is an additive change, not a reshape. And keep purge-by-path (which already spans any file) the single mechanism for both note and attachment permanent-delete.
