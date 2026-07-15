-- 012: health of the git-based vault backup (docs/VAULT_BACKUP.md).
--
-- The vault (the notes' .md files + any binaries) is snapshotted into a separate git
-- dir alongside the DB snapshots; these columns record the outcome of that snapshot,
-- kept DISTINCT from the DB backup's last_status/last_error so a vault-git failure
-- never masks (or is masked by) the SQLite backup's own status. Written by
-- snapshotVault() in vault-git.ts, surfaced through GET /api/backups/config.
--
-- NULL = no vault snapshot has run yet. The vault backup shares backup_config.enabled
-- with the DB backup — one switch, both-or-nothing (no separate vault toggle).
ALTER TABLE backup_config ADD COLUMN vault_last_status TEXT;
ALTER TABLE backup_config ADD COLUMN vault_last_error TEXT;
ALTER TABLE backup_config ADD COLUMN vault_last_run_at TEXT;
