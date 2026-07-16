# tdx API v1.0.0

> Generated from the live OpenAPI spec (`docs/openapi.json`). Do not hand-edit — run `npm run export:openapi`.

The tdx productivity API: **tasks**, **events** (calendar), and **notes** (a file-backed vault), unified by a shared query language (`POST /api/query`) and cross-app categorizers (a project / calendar / folder matched by name). Every resource is scoped to the authenticated user.

**Authentication** — two interchangeable credentials, accepted on every non-public route:
- **Session cookie** (`tdx_session`): from `POST /api/auth/login`; browser flow, full scope.
- **Bearer token** (`Authorization: Bearer tdx_pat_…`): a scoped personal access token from `POST /api/auth/tokens`; for agents/integrations. A `read`-only token cannot write.

Writes additionally require **write** scope; admin routes require an **admin** account — OpenAPI can't express that structurally, so each such operation notes it in its description.

## Admin

### `POST /api/admin/users` — Create a user

Create a new account. **Admin only.** Validation errors return 400 with a `field`; a username/email already in use returns 409.

Responses: 201, 400, 409

## Auth

### `PUT /api/auth/account` — Update account settings

Update profile, preferences, and/or credentials — every field is optional; only those present are changed. Changing the password requires `oldPassword` and revokes all *other* sessions. Field-specific validation errors return 400 with a `field`; username/email collisions return 409.

Responses: 200, 400, 401, 409

### `POST /api/auth/login` — Log in

Exchange a username + password for a session cookie (`tdx_session`). **Public** (the only unauthenticated write route); rate-limited. On success sets the cookie and returns the user.

Responses: 200, 401, 429

### `POST /api/auth/logout` — Log out

Revoke the current session and clear the cookie.

Responses: 200

### `GET /api/auth/me` — Current user

The authenticated user behind the current credential.

Responses: 200, 401

## Backups

### `GET /api/backups` — List backup files

The DB snapshot files in the configured backup directory. **Admin only.**

Responses: 200

### `GET /api/backups/{name}/download` — Download a backup file

Stream a backup `.db` file (octet-stream). **Admin only.**

Responses: 400, 404

### `GET /api/backups/browse` — Browse the filesystem

Directory picker for choosing a backup location. **Admin only.**

Responses: 200, 400

### `GET /api/backups/config` — Get backup config & health

Current backup schedule + DB/vault health. **Admin only.**

Responses: 200

### `PUT /api/backups/config` — Update backup config

Enable/schedule backups (DB **and** vault share one switch). `dir` must be absolute; `time_of_day` is `HH:MM`; `retention` is 1–365. **Admin only.** Invalid values return 400.

Responses: 200, 400

### `POST /api/backups/run` — Run a backup now

Trigger an immediate DB snapshot + vault git snapshot. **Admin only.**

Responses: 200, 500

## Bootstrap

### `GET /api/bootstrap` — Fetch the whole account

The SPA startup read: every entity for the authenticated user (projects, calendars, folders, tasks, labels, saved queries) in one payload. Notes/events are fetched separately.

Responses: 200

## Calendars

### `POST /api/calendars` — Create a calendar

Create a calendar to group events. Requires **write** scope.

Responses: 201, 400

### `GET /api/calendars/{id}` — Get a calendar

Responses: 200, 403, 404

### `PUT /api/calendars/{id}` — Update a calendar

Partial update. Requires **write** scope. Honors `If-Match`; a stale write returns **412** with the current entity under `current`.

Responses: 200, 400, 403, 404, 412

### `DELETE /api/calendars/{id}` — Delete (archive) a calendar

Requires **write** scope. Returns 204 on success.

Responses: 204, 403, 404

## Events

### `POST /api/events` — Create an event

Create a calendar event. Requires **write** scope.

Responses: 201, 400

### `GET /api/events` — List events in a date range

Return events between `from` and `to` (ISO dates), with recurring events **expanded** into concrete occurrences (each carries the `date` it falls on).

Responses: 200

### `GET /api/events/{id}` — Get an event

Responses: 200, 403, 404

### `PUT /api/events/{id}` — Update an event

Partial update. Requires **write** scope. Honors `If-Match`; a stale write returns **412** with the current entity under `current`.

Responses: 200, 400, 403, 404, 412

### `DELETE /api/events/{id}` — Delete (archive) an event

Requires **write** scope. 204 on success.

Responses: 204, 403, 404

## Folders

### `POST /api/folders` — Create a folder

Create a vault folder (a real directory) to group notes. Requires **write** scope. Renaming later moves the directory and its notes.

Responses: 201, 400, 403, 404

### `GET /api/folders/{id}` — Get a folder

Responses: 200, 403, 404

### `PUT /api/folders/{id}` — Update (or rename/move) a folder

Partial update. Requires **write** scope. A name change moves the directory and re-paths its notes. Honors `If-Match`; a stale write returns **412** with the current entity under `current`.

Responses: 200, 400, 403, 404, 412

### `DELETE /api/folders/{id}` — Delete a folder

Delete an **empty** folder. Requires **write** scope. A non-empty folder returns **409** — move or delete its contents first. Returns 204 on success.

Responses: 204, 403, 404, 409

## Health

### `GET /health` — Liveness probe

Unauthenticated health check. Returns 200 while the server is up.

Responses: 200

## Labels

### `POST /api/labels` — Create a label

Create a tag usable across tasks/events/notes. Requires **write** scope.

Responses: 201, 400

### `GET /api/labels/{id}` — Get a label

Responses: 200, 403, 404

### `PUT /api/labels/{id}` — Update a label

Rename or (un)pin a label. Requires **write** scope.

Responses: 200, 403, 404

### `DELETE /api/labels/{id}` — Delete a label

Delete a label (untags everything). Requires **write** scope. 204 on success.

Responses: 204, 403, 404

### `POST /api/labels/merge` — Merge two labels

Re-point everything tagged `from` onto `to`, then delete `from`. Requires **write** scope.

Responses: 200, 400, 403, 404

## Links

### `POST /api/links` — Create a link

Create an undirected link between two entities (task/event/note). Requires **write** scope; both endpoints must be visible to the caller. An invalid pairing returns 400.

Responses: 201, 400, 403, 404

### `GET /api/links` — List an entity's links

All links attached to the entity identified by `type` + `id`.

Responses: 200, 403, 404

### `DELETE /api/links/{id}` — Delete a link

Requires **write** scope. 204 on success.

Responses: 204

## Notes

### `POST /api/notes` — Create a note

Create a markdown note (writes the `.md` file, then indexes it). Requires **write** scope.

Responses: 201, 400

### `GET /api/notes` — List notes

All notes for the user (list projection — `body` is fetched via GET /api/notes/:id).

Responses: 200

### `GET /api/notes/{id}` — Get a note

Fetch a single note including its `body` (read live from the vault file).

Responses: 200, 403, 404

### `PUT /api/notes/{id}` — Update a note

Partial update (rewrites the `.md` file). Requires **write** scope.

Responses: 200, 403, 404

### `DELETE /api/notes/{id}` — Delete a note

Delete the note and its `.md` file. Requires **write** scope. 204 on success.

Responses: 204, 403, 404

### `GET /api/notes/search` — Search notes

Full-text search over note titles + bodies. Returns hits with a highlighted snippet.

Responses: 200

### `POST /api/notes/sync` — Sync the vault

Reconcile the DB index with the on-disk vault after external edits (nvim/Obsidian). `mode=incremental` (default) only rescans changed files; `mode=full` rescans everything. Requires **write** scope. Returns counts of scanned/updated/tombstoned notes.

Responses: 200

## Projects

### `POST /api/projects` — Create a project

Create a project (a node in the task tree). Requires **write** scope.

Responses: 201, 400, 403, 404

### `GET /api/projects/{id}` — Get a project

Responses: 200, 403, 404

### `PUT /api/projects/{id}` — Update a project

Partial update. Requires **write** scope. Honors `If-Match`; a stale write returns **412** with the current entity under `current`.

Responses: 200, 400, 403, 404, 412

### `DELETE /api/projects/{id}` — Delete (archive) a project

Archives the project and cascades to its subtree. Requires **write** scope. 204 on success.

Responses: 204, 403, 404

## Query

### `POST /api/query` — Run a unified query

Run a tdx query across tasks/events/notes and get back matching entities. The query is a space-separated set of predicates, e.g. `status:open due:<7d label:urgent`. `type:task,event,note` selects which entity kinds to return (default `task`); `category:`/`project:`/`folder:`/`calendar:` filter by name; `limit`/`offset` paginate. Each result carries a `type` discriminator plus that entity's fields. An unknown `type:` token returns 400.

Responses: 200, 400

## Saved Queries

### `POST /api/saved-queries` — Create a saved query

Save a named query view (`query` is a tdx query string). Requires **write** scope.

Responses: 201, 400

### `GET /api/saved-queries/{id}` — Get a saved query

Responses: 200, 403, 404

### `PUT /api/saved-queries/{id}` — Update a saved query

Partial update of a saved view. Requires **write** scope.

Responses: 200, 403, 404

### `DELETE /api/saved-queries/{id}` — Delete a saved query

Requires **write** scope. 204 on success.

Responses: 204, 403, 404

## Tasks

### `POST /api/tasks` — Create a task

Create a to-do item. Requires **write** scope. `id` may be a client-supplied UUID.

Responses: 201, 400, 403, 404

### `GET /api/tasks/{id}` — Get a task

Fetch a single task by id. Sends an `ETag` for optimistic concurrency.

Responses: 200, 403, 404

### `PUT /api/tasks/{id}` — Update a task

Partial update. Requires **write** scope. Send `If-Match` with the task's `ETag`; a stale write returns **412** with the current entity under `current`.

Responses: 200, 400, 403, 404, 412

### `DELETE /api/tasks/{id}` — Delete (archive) a task

Soft-archive a task. Requires **write** scope. Returns 204 on success.

Responses: 204, 403, 404

### `POST /api/tasks/{id}/assign` — Assign a task

Set or clear the assignee (`assigneeId: null` clears). Requires **write** scope.

Responses: 200, 400, 403, 404

### `POST /api/tasks/{id}/complete` — Complete a task

Mark done. If the task recurs, this spawns the next occurrence and a fresh unchecked subtask subtree. Requires **write** scope. Returns `{ task, created }`.

Responses: 200, 403, 404

## Tokens

### `POST /api/auth/tokens` — Create a personal access token

Mint a PAT for an agent/integration. Requires **write** scope. `scopes` defaults to `["*"]` (full); pass e.g. `["read"]` for a read-only token. The raw `token` is returned **once**.

Responses: 201, 400

### `GET /api/auth/tokens` — List personal access tokens

Token metadata for the account (never the raw token).

Responses: 200

### `DELETE /api/auth/tokens/{id}` — Revoke a personal access token

Revoke a token by id. Requires **write** scope. Returns 204 on success.

Responses: 204, 404
