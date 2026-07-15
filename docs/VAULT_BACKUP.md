# Vault backup — design (ships with the Events & Notes release)

The durability half of the Notes feature: make the file-backed vault recoverable, not just the database. This is the MVP that should land with (or right after) the Events & Notes deploy. The user-facing version-history and permanent-delete features that this substrate enables are captured separately in [`VAULT_VERSION_CONTROL.md`](VAULT_VERSION_CONTROL.md) and are explicitly **not** part of this doc.

## Goal

The bar: *an average homelabber can pull this repo, enable backups, and restore both their tasks and their full vault after a loss — assuming their disk is secure and readable.* No ZFS or offsite required to clear that bar; those are a bonus an advanced user can layer on, not a dependency.

## Why the vault needs its own backup

Note **content lives as `.md` files on disk** (the vault); the `notes` / `note_links` / `notes_fts` tables are a **rebuildable shadow index** derived *from* those files on scan (see `server/migrations/004_notes.sql` — it says so at the top). Data flows files → DB, never DB → files.

That means neither existing half is sufficient alone:

- The **DB backup** (`server/src/backup.ts` — a scheduled online `sqlite.backup()` to `/backups`, 7-day rolling) covers tasks, events, projects, labels, saved queries, and the notes *shadow* — but not the note *files*, and not any non-`.md` file (images, PDFs, attachments have zero DB representation).
- The **vault files** hold the real note content and all binaries — but nothing about tasks/events/projects lives there.

So "restore the vault **and** tasks" requires backing up **both** the DB (already done) and the vault directory (this doc). The DB's 7-day rolling window stays as-is — that's fine for tasks.

## Why git (and not tar snapshots)

A markdown vault is close to an ideal git workload, and git beats a tar-per-run snapshot on every axis that matters here:

- **No duplication.** Content-addressed storage keeps identical content once; text edits are deltas. Full history of a text vault costs a few MB, versus tar copying the whole vault every run.
- **Point-in-time, per-file.** "What did this note look like a month ago" is one command. The DB's 7-day window can't do this; git's history is the whole point.
- **Corruption isolation, natively.** Git can keep its repo in a *separate directory* from the working tree (below), so a wiped/corrupted vault dir doesn't take the history with it.
- **Trivially offsite-able.** It's a real repo — an advanced user can `git remote add` + push, or rsync/ZFS the git dir. No bespoke export format.
- **Universally understood.** A homelabber already knows git.

The one place git is *worse* than tar-with-retention is **binaries**: git stores a full copy per version and reachable history can't be easily pruned. For a text-first vault that's a non-issue; the pruning story (and the "I stored a huge PDF / my SSN" case) is handled by the permanent-delete feature in the enhancements doc, not here.

## Design

**Separate git dir, single linear branch, append-only.** This is "git as a snapshot log," not full git — no branches, no merges, no user-facing VCS in the MVP.

- **Working tree = the vault, repo = elsewhere.** Use git's native work-tree/git-dir split so there is **no `.git` folder inside the vault** (which also keeps the scanner from having to walk it):
  ```sh
  git --git-dir="$BACKUP_DIR/vault.git" --work-tree="$VAULT_DIR" add -A
  git --git-dir="$BACKUP_DIR/vault.git" --work-tree="$VAULT_DIR" commit -m "vault snapshot …"
  ```
  The layout is `--git-dir=/backups/vault.git --work-tree=/vault`, so the history lives in the same `/backups` mount the user already backs up, alongside the DB snapshots — and survives the vault dir being lost.
- **Trigger: the backup scheduler, skip-if-clean.** Snapshots run on the existing backup cadence (`backup_config`'s schedule), committing only when the working tree is dirty (`git add -A`, then commit only if something changed). Because the trigger is filesystem-state-based, a scheduled snapshot captures everything — including edits made **outside** the app (nvim, Obsidian). Per-save commits are deliberately not the primary mechanism: they'd be chatty, and on their own would miss external edits. The app may *optionally* also fire a commit on an in-app save for immediacy, but that's a convenience layered on top, not the guarantee. The MVP accepts one limitation: a direct external edit isn't captured the instant it happens — it lands in the next scheduled snapshot, which is acceptable at this stage.
- **One switch, shared with the DB backup.** The vault git backup reuses `backup_config` and its single enable toggle: turning backups on enables both the DB snapshot and the vault snapshot; turning them off disables both. There is no separate vault on/off — it's both or nothing.
- **Ignore rules: minimal and fixed.** A small built-in ignore covers tool/OS cruft (`.obsidian/`, `.DS_Store`, and the like); everything else in the vault is snapshotted, with **no size guard** — silently dropping a large-but-legitimate file would fight the "restore everything" goal. Making the ignore user-configurable (globs, size thresholds) is a deferred power-user feature — see [`VAULT_VERSION_CONTROL.md`](VAULT_VERSION_CONTROL.md) Feature C.
- **First-run init.** On boot, if `$BACKUP_DIR/vault.git` is absent, `git init` the separate dir and take an initial commit (handling the empty-vault case — nothing to commit yet). The committer identity is the **note owner's username**, not a generic bot, so history is attributed per-user from the start, ahead of the eventual multi-user editing.
- **Git dependency & licensing.** The image gets `git` on `PATH` via a one-line Dockerfile add from the distro package. Licensing is a non-issue and needs no changes: tdx only *shells out to the `git` CLI* (a subprocess) and never links git's code, so git's GPLv2 copyleft does not reach tdx's own source — **tdx's license is unaffected.** Bundling the binary in the published image only makes tdx a redistributor of *git itself* (an obligation about git, not about tdx), satisfied for free by installing from the distro, which carries git's license and source availability. `isomorphic-git` (MIT, pure JS, no binary shipped) stays the lever if we ever want git behavior without distributing the binary — but for a container app it isn't worth the tradeoff.
- **Interaction with the scanner's writeback.** The scanner injects a frontmatter `id` into files that lack one (`notes.ts` ~line 111), which is a legitimate file change — so the first snapshot after importing external files will include those id injections. Expected, not a bug.
- **DB stays on its own mechanism.** Git won't delta a sqlite blob usefully, and tasks don't need month-old history, so the DB is not committed into the vault repo — it keeps its existing 7-day rolling `sqlite.backup()`. (The notes shadow rebuilds from the files anyway, so it doesn't need to be in git.)

## Restore

Files are truth, so every restore ends by letting the scanner rebuild the DB shadow:

- **A single file, point-in-time (CLI in MVP; friendly UI is the enhancements doc):**
  ```sh
  git --git-dir=/backups/vault.git show <commit>:relative/path.md > /vault/relative/path.md
  ```
- **The whole vault, current tip:** `git --git-dir=/backups/vault.git --work-tree=/vault checkout -- .`
- **Disaster — vault dir gone entirely:** the repo at `/backups/vault.git` still has everything; check out a fresh work tree into a new `/vault`.
- **Then:** trigger a rescan (or just restart) so the DB shadow reconciles to the restored files. Order is always files → rescan.

## What it covers / doesn't

- **Covers:** every file in the vault (`.md` byte-exact and binaries), full linear history, point-in-time per-file restore, corruption isolation (separate git dir), and offsite-ability for an advanced user.
- **Doesn't:** it is *loss recovery* under "disk is secure and readable" — not tamper/ransomware protection (same disk), not history pruning (binaries grow unbounded until the permanent-delete feature lands), and not task history beyond the DB's 7-day window (by design).

## Scope boundary

Out of this doc, in [`VAULT_VERSION_CONTROL.md`](VAULT_VERSION_CONTROL.md): the in-app version-history/restore UI, and permanent-delete-with-history-pruning (the "soft archive vs hard delete" idea). The MVP here just makes the history *exist* and be restorable from the CLI.
