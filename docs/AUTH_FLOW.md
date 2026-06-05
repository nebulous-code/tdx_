# Authentication Flow

## Change Summary

Add a full authentication flow: login, logout, password change, username, and email — backed by **multi-tenant** data (each user has their own tasks/projects/labels/views). No self-service registration (users are created by a CLI script), no forgot-password, no admin/cross-user management. A forgotten password is fixed by running the reset script against the DB.

This document is the agreed spec. Decisions from the first review round are folded into the body below; new questions raised by going multi-tenant are in **[Open Questions — Round 2](#open-questions--round-2)** at the bottom.

---

## Locked decisions (round 1)

- **Multi-tenant from day one.** We designed the storage to allow it ("family multi-user later"); we'll honor that now rather than retrofit.
- **Existing data → first user.** All current rows belong to the first account created (me).
- **Sessions:** server-side, DB-backed, delivered via an httpOnly + SameSite cookie. `credentials: 'include'` on frontend fetches.
- **Session lifetime:** 30-day sliding expiry (refreshed on use).
- **Secret:** `SESSION_SECRET` in `.env` (gitignored), stable across restarts; rotating it logs everyone out.
- **Transport:** plain HTTP over LAN is acceptable (no `Secure` flag, no HTTPS for now).
- **Login hardening:** generic "invalid username or password" error + basic rate-limiting.
- **Hashing:** `@node-rs/argon2`, **argon2id**, hardcoded `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }` (WASP/Lucia/OWASP-aligned). No `.env` knobs.
- **Password storage:** single `password_hash` column (argon2 embeds the salt + params); no separate `salt` column.
- **Tooling:** Node scripts in `tools/` (`add-user.js`, `reset-password.js`), run via `docker compose exec`; passwords prompted on stdin with no echo, never passed as args.
- **Login surface:** in-app screen rendered when there's no current user; the global keydown handler is not attached until authenticated (so app shortcuts are off on the login screen).
- **Logout:** lives on the account screen.
- **Email:** stored but functionally inert for now (SMTP/recovery may come later).
- **Password change:** revokes all of that user's other sessions; the new password must differ from the current one.
- **Account screen:** behaves like another navigable window (parallel to filter / nav / task-list), opened with `@` or by clicking the username.
- **Username rules:** unique (case-insensitive), trimmed, 1–32 chars.
- **Password policy** (≥8 chars, ≥1 upper, ≥1 lower, ≥1 number, ≥1 symbol): enforced in **both** the account screen and the CLI scripts.

## Locked decisions (round 2)

- **Composite primary keys** `(user_id, id)` on the data tables; the client id scheme is unchanged.
- **First user adopts** all owner-less rows; every later user is seeded fresh (inbox + system views).
- **Rate limit:** in-memory, keyed by username+IP — 5 failures / 15 min → 60s backoff (resets on restart).
- **Session token:** store a SHA-256 **hash** in `sessions.id`; the raw token lives only in the cookie.
- **Username:** `UNIQUE COLLATE NOCASE`, stored as typed. **Email:** `NOT NULL UNIQUE` (case-insensitive), one per user (future SMTP).
- **Account screen:** a takeover popup — not part of the `h/l` pane cycle; it captures `j/k/i` (and Enter/Esc) while open, until save/exit.

---

## Data model

### New tables

**`users`**
- `id` TEXT PRIMARY KEY — server-generated (e.g. `u_<n>` or a random id).
- `username` TEXT NOT NULL UNIQUE COLLATE NOCASE — stored as typed, matched case-insensitively.
- `email` TEXT NOT NULL UNIQUE COLLATE NOCASE — one email per user; inert today, reserved for future SMTP.
- `password_hash` TEXT NOT NULL — full argon2id encoded string.
- `state_version` INTEGER NOT NULL DEFAULT 0 — per-user optimistic-concurrency counter (replaces the single global `meta.version`).
- `created_at`, `updated_at`.

**`sessions`**
- `id` TEXT PRIMARY KEY — a SHA-256 **hash** of the session token (raw token lives only in the cookie).
- `user_id` TEXT NOT NULL → `users(id)`.
- `created_at`, `expires_at` (sliding), optional `last_seen`.

### Scoping existing tables to a user

`projects`, `tasks`, `labels`, `saved_queries`, and the `task_labels` join all gain a `user_id`. Because the client generates ids from a per-load counter (`prefix_N`), ids are only unique **within** a user, so the primary keys become composite: `PRIMARY KEY (user_id, id)` on each table, with intra-user foreign keys (e.g. `tasks.parentId` references `(user_id, id)`).

SQLite can't alter a primary key in place, so this migration rebuilds those tables (create new with the composite PK + `user_id`, copy rows, drop old).

### Per-user state & version

`GET/PUT /api/state` operate only on the logged-in user's rows. `PUT` replaces that user's rows transactionally (delete-all-for-user + insert) and bumps `users.state_version`. A stale version returns `409` with the user's current state, exactly as today — but isolated per user, so one account's writes never conflict with another's.

---

## Sessions & security

- On successful login: create a `sessions` row, set an httpOnly, `SameSite=Strict` cookie holding the session token (no `Secure` flag, since plain HTTP).
- Every protected request: look up the session by token hash, check `expires_at`, slide it forward, attach `request.user`.
- `/api/state` (and the account routes) are guarded; unauthenticated requests get `401`. The frontend treats `401` as "show the login screen."
- **Rate-limiting:** basic, in-memory (resets on restart) — throttle repeated failed logins (scope/threshold in Open Q3).
- **Logout:** delete the current session row and clear the cookie.
- **Password change:** delete all of the user's sessions except (optionally) the current one.

---

## Backend API

- `POST /api/auth/login` — `{ username, password }` → sets cookie, returns `{ id, username, email }`. Generic error on failure.
- `POST /api/auth/logout` — clears session + cookie.
- `GET  /api/auth/me` — returns the current user or `401` (frontend uses this on load to decide login vs app).
- `PUT  /api/auth/account` — update `username` / `email`; password change requires `{ oldPassword, newPassword }` (verified, policy-checked, must differ from current). Revokes other sessions on password change.

Registered before `@fastify/static` so `/api/*` wins over the SPA. Adds `@node-rs/argon2` and `@fastify/cookie` deps; `SESSION_SECRET` to `.env(.example)` and `compose.yaml`.

---

## Frontend

### Login screen
- In-app screen shown when `store.currentUser` is null. Same CRT/amber styling as the app.
- Username + password fields; Enter submits; Tab moves between fields. The global app keydown handler is **not** attached while unauthenticated.
- On success, store the user and mount the app (hydrate state).

### Account screen
- Opened with `@` (ignored while typing in an input) or by clicking the username in the header. Styled like the Quick Reference screen, with the background fade.
- Edit username and email. Change password = old password + new password ×2, enforcing the policy and the "must differ from current" rule.
- Behaves like a window: `j/k` move between the inputs, `i` (or click) drops into edit/insert mode — mirroring the filter-window grammar. It's a takeover popup (not part of the `h/l` pane cycle): while open it captures `j/k/i` and Enter/Esc until you save or exit.
- Enter = save; a Save button is also present. Top-right `X` exits. Escape exits without saving, but if anything changed it shows a same-styled confirm popup: **"Changes will be lost. Continue? Yes (enter) No (esc)"** (so it's Esc→Enter to discard — intentional, not an accidental double-Esc). Clicking outside the window behaves like Escape/close (with the same unsaved-changes prompt).
- Contains the **Logout** action.

### Header cleanup
- Left: `tdx_ | HH:MM:SS DoW MMM DD` (date/time moved left next to the brand).
- Right: `# open | # overdue | USERNAME` (stats moved right, beside the username; username opens the account screen).
- Use the pipe `|` separator consistently (replace the `·` dot).
- The `?` help screen moves its close control to an `X` in the top-right (matching the account screen) instead of a bottom "close" button.

---

## User-management tooling (`tools/`)

Node scripts hitting the live DB, run via `docker compose exec tdx node tools/<script>.js`.

### `add-user.js`
Prompts for username, email, and password (password hidden, no echo). Validates username rules + password policy, hashes with argon2id, inserts the user.
- **First user adopts existing data:** when the first account is created, all pre-auth rows (no owner) are assigned to it; subsequent users get a freshly seeded inbox project + the system smart-views (see Open Q2).
- The plaintext password is never persisted by the script.

### `reset-password.js`
Prompts for a username, then a new password (hidden). If the username doesn't exist, prints a message and exits. Otherwise validates the policy, ensures the new password differs from the current one (argon2 verify against the stored hash), hashes, and updates the row. (Also revokes that user's sessions.)

---

## Migration & bootstrap order

1. Migration adds `users` + `sessions`, adds `user_id` to the data tables (rebuilding for the composite PK), and moves the version counter to per-user. Existing rows are left owner-less until the first user is created.
2. Run `add-user.js` once → first user is created and **adopts** all owner-less rows.
3. Log in. Until a user exists, the login screen simply rejects all attempts.

---

## Resolved (round 2)

Answered inline below; all decisions are folded into the spec above. Kept as a record.

**Q1. Client-generated id collisions across users (most important).**
The client mints ids like `t_101` from a counter that resets each page load, so two users will produce the same id. Options:
- **(a) Composite primary keys** `(user_id, id)` on every data table, with intra-user foreign keys. Keeps the existing client id scheme untouched; the migration rebuilds the tables.
- **(b) Globally-unique ids** — change the client to mint collision-proof ids (e.g. prefix with the user, or switch to random/ULID). Simpler schema, but changes id generation and any assumptions about id format.
- **Recommendation:** (a). It's the smallest change to the working client and matches the "snapshot replace per user" model.
- **Response** - Composit pk is ideal

**Q2. First-user adoption mechanic.**
How do we decide the one-time "adopt existing data" step? Proposed: when `add-user.js` runs and the `users` table is empty (this is the first user), assign all owner-less rows (`user_id IS NULL`) to the new user; every later user instead gets a fresh seeded inbox + system views.
- **Recommendation:** as described (first user adopts orphan rows; everyone after is seeded fresh).
- **Response** sounds good

**Q3. Rate-limit specifics.**
Scope and thresholds for failed logins. Proposed: in-memory, keyed by username+IP, e.g. after 5 failures within 15 minutes, reject for 60s (backoff). Resets on process restart.
- **Recommendation:** the above; tune the numbers if you have a preference.
- **Response** sounds good

**Q4. Session token storage.**
Store a **hash** (e.g. SHA-256) of the session token in `sessions.id`, so a DB read can't be replayed as a live session — the raw token lives only in the cookie. Tiny extra step.
- **Recommendation:** yes, store the hash.
- **Response** sounds good

**Q5. Username uniqueness collation.**
Enforce case-insensitive uniqueness via `UNIQUE COLLATE NOCASE` on `username` (and match case-insensitively at login), storing the username as the user typed it for display. Email: store as-is, no uniqueness constraint (it's inert)?
- **Recommendation:** NOCASE-unique username stored as-typed; email stored as-is, not unique.
- **Response** nocase unique is find. Email should be uniquie, I will eventually use it for smtp and we want to have 1 email per user.

**Q6. Account screen: modal vs. true fourth pane.**
You pictured the account screen as "just another window like filter/nav/task-list." Implementation-wise it's a modal overlay (Quick-Reference style, with the fade), but it reuses the same `j/k` + `i`-to-edit nav grammar internally. So it *feels* like a pane without being part of the always-on `focusPane` rotation. Flagging so the wording isn't a surprise — no change needed unless you want it to literally join the `h/l` pane cycle.
- **Response** that sounds fine. It should not be in the h/l pane cycle. it will be a popup that basically takes over the j/k/i keys while the user is interacting with it until they save/exit
