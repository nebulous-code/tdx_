# Vault version control & permanent delete — design (future enhancements)

The user-facing features that sit on top of the git history laid down by [`VAULT_BACKUP.md`](VAULT_BACKUP.md). None of this is required for the Events & Notes release — the point of committing the vault to git from day one is that this history silently accrues, so these become "expose and manage history that already exists" rather than "go build a versioning system." Captured here so the MVP doesn't have to carry it.

## What the substrate gives us for free

Once the MVP is committing the vault to a separate-dir git repo on a schedule, every note file already has a full linear history. These features are UI and history-management on top of that — no new storage model.

---

## Feature A — in-app version history & restore

Let a user see and roll back a note's past states from inside the notes app, instead of dropping to the git CLI.

- **Browse:** a note's history is `git log`/`git show` for that file's path — a list of versions with timestamps, a preview, and a diff against the current text (markdown diff rendering).
- **Restore:** writing a chosen old version back to the file, which the next scan reconciles into the DB shadow. A restore is **non-destructive** — it's just a new commit on top, so you can always undo the undo.
- **Scope:** notes are files, so they have history. Tasks and events are DB-only and are **not** in git, so this is a **notes-only** feature unless we later decide to also snapshot the DB into git (see Non-goals). That's consistent with the decision that tasks are fine on the 7-day rolling DB backup.

## Feature B — permanent delete (soft archive vs hard delete)

The headline enhancement. Normal deletion is *soft*: the file leaves the vault but every past version still lives in git history — recoverable, which is exactly what you want for an accidental delete. **Permanent delete** is the escape hatch for the two cases where history *persisting* is the problem:

1. **Space.** Someone stored a large binary (a big PDF, a pile of images); deleting it from the vault doesn't reclaim the space because every version is pinned in history. Permanent delete purges it and lets `git gc` reclaim.
2. **Sensitive content.** A non-technical user pastes their SSN, bank details, or an actual secret into a note (the notes analogue of committing a `.env`). A soft delete leaves it forever in history; only a hard delete actually scrubs it.

**UX framing (the user's insight):** present this as **archive vs delete permanently**, not as "git history rewrite." The friendly surface is a soft "Delete (recoverable)" as the default, and a distinct, high-friction "Delete permanently — removes every past version, cannot be undone" (type-to-confirm, matching the archive-project restore/hard-delete pattern already planned). Under the hood, "delete permanently" is a targeted history rewrite that purges all versions of that path, followed by a repack/gc.

**Hazards to design around (this is destructive and global):**

- **History rewrite changes commit hashes** for everything after the purge point. Fine for a private, single-writer backup repo; it just needs the commit loop paused during the rewrite so nothing races it.
- **Copies you already synced offsite are out of reach.** If the "fancy user" pushed the git dir to a remote or a ZFS/offsite target, a local purge does **not** reach those copies — the sensitive data survives wherever it was replicated. The honest UX is to *warn* that permanent delete only scrubs the local history and can't reclaim copies made elsewhere; attempting to rewrite remote history automatically is out of scope (and often impossible).
- **It's a purge-by-path, not general rebase.** We expose exactly "obliterate this note / this file across all history," nothing resembling interactive branch surgery.

---

## Feature C — power-user-configurable ignore rules

The MVP ships a minimal, fixed ignore (tool/OS cruft only — see [`VAULT_BACKUP.md`](VAULT_BACKUP.md) D4). Later, let a power user configure what the vault backup ignores — exclude a scratch folder, skip files over a size threshold — so they can keep git history lean **proactively**, rather than reaching for permanent-delete after bloat is already committed. It's the preventive complement to Feature B's after-the-fact cleanup. Deferred from the MVP because a sensible fixed default covers the common case, and a bad user-supplied ignore that silently drops real notes is worse than no config — so it needs a careful UX (show what a rule would exclude before it takes effect).

---

## Non-goals (captured so they're decided, not forgotten)

- **Task/event version history.** Tasks are DB-only and the 7-day rolling backup is considered sufficient. We are *not* snapshotting the DB into git just to give tasks month-old history. If that ever changes, the path is "commit a DB dump into the vault repo too," but it's explicitly not planned.
- **Productized offsite sync.** Pushing the vault repo to a remote is currently a manual advanced-user step. Turning "add a git remote / push on schedule" into a first-class in-app setting is a candidate, not committed — noting it here so it isn't lost.
- **Branching / merging / collaboration.** The vault repo stays linear and single-writer. Multi-user note collaboration is a separate initiative entirely (and interacts with the dormant sharing surface, not this).

---

## Open decisions

- **E1 — history-rewrite tooling.** `git filter-repo` (fast, clean, but an extra dependency to install in the image) vs `git filter-branch` (built-in but slow and deprecated) vs a bare-repo re-pack approach? This picks how "permanent delete" is actually implemented.
- **E2 — hard-delete granularity.** Purge a whole note's history by path only, or also support purging a *single embedded attachment/binary* while keeping the note? The binary case is the main space motivation, so attachment-level purge may be worth it.
- **E3 — offsite/remote handling on purge.** Warn-only ("this can't reach copies you synced elsewhere") vs attempting a remote rewrite? *Leaning: warn-only — remote rewrite is fragile and often not ours to do.*
- **E4 — where hard-delete lives.** A per-note "delete permanently" action, a dedicated "manage vault storage/history" admin screen (which also shows what's eating space), or both? And the confirmation friction (type-the-note-name, like the planned project hard-delete).
- **E5 — restore/history UX.** An inline per-note history panel vs a global "vault history" browser. Diff presentation (rendered markdown diff vs raw text diff).
- **E6 — restore semantics.** Confirm a restore is always a new commit on top (safe, reversible) rather than a history rewrite — *strongly recommended*, just want it on record.
- **E7 — does version history stay notes-only?** Default yes (tasks/events excluded, since they're not in git). Flag if you'd ever want task history to pull the DB into git after all.
- **E8 — where configurable ignore rules live (Feature C).** A settings screen, an editable ignore file in the vault, or the backup dir? And whether rules are globs, size thresholds, or both — plus how to preview what a rule would drop before committing to it.
