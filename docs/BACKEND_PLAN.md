# tdx_ — Backend Plan (proposal)

How to take the front-end prototype to a self-hosted, multi-device app:
**Docker + SQLite**, reached over a **tailnet**, installable as a **PWA** on
desktop and phone, with reminders that actually fire.

This is a proposal, not yet built. Decisions for you to confirm are collected at
the end.

---

## 1. Constraints & what shapes the design

| Fact | Consequence |
|---|---|
| **Single user** (you, a few devices) | No multi-tenant auth, no per-row ownership. Tailnet is the security perimeter. |
| **Small data** (hundreds of tasks, not millions) | Don't push query/recurrence logic into SQL. Ship the whole dataset to the client and reuse the engines you already wrote. |
| **Pure engines already exist** | `recurrence.js` and `query.js` are pure functions the design doc flagged as "liftable." Reuse them verbatim → pick a **Node** backend so they run unchanged on both sides. |
| **PWA + reminders** | Needs **HTTPS** (service workers) and a **long-running process** (push scheduler). Both are easy with Tailscale Serve + a Docker container. |

**Guiding principle:** the backend is a thin, durable, *authoritative* store +
a notification scheduler. It is not where queries run. The client stays smart;
the server stays simple and always-on.

---

## 2. Recommended stack

- **Runtime:** Node.js (LTS). Reason: run `recurrence.js`/`query.js` unchanged on
  the server — the recurrence math (nth-weekday, month clamping, week phase) is
  fiddly and you do not want a second, drifting implementation in another language.
- **HTTP:** Fastify (or Express if you prefer familiarity). Small, fast, fine for one user.
- **DB driver:** `better-sqlite3` — synchronous, in-process, zero-config, and a great
  fit for a single-user SQLite app. Enable WAL mode.
- **Migrations:** plain SQL files run on boot (or `node-pg-migrate`-style tooling).
  Schema is small; a hand-rolled `migrations/NNN_*.sql` runner is enough.
- **Push:** `web-push` (VAPID) for Web Push notifications to installed PWAs.
- **Scheduler:** a single `setInterval`/`node-cron` tick (every minute) for reminders.

> Alternative if you'd rather not write Node: any stack works for CRUD, but you'd
> reimplement recurrence server-side. Given that engine already exists in JS, Node
> is the path of least resistance and least duplication.

---

## 3. Data model → SQLite schema

Direct translation of the prototype model (`DESIGN_DOC.md` §3), with `labels[]`
normalized into a join table and `updated_at` added for sync.

```sql
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,         -- client-generatable ULID
  parent_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  glyph      TEXT NOT NULL,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  position   REAL,                     -- for future drag-reorder
  updated_at TEXT NOT NULL,
  deleted_at TEXT                      -- soft delete for sync
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES tasks(id)    ON DELETE CASCADE,
  title        TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  due          TEXT,                   -- 'YYYY-MM-DD'
  reminder     TEXT,                   -- 'YYYY-MM-DD' (later: full timestamp)
  recurrence   TEXT,                   -- the syntax string, stored verbatim
  notes        TEXT NOT NULL DEFAULT '',
  position     REAL,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE TABLE labels (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE task_labels (
  task_id  TEXT REFERENCES tasks(id)  ON DELETE CASCADE,
  label_id TEXT REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE saved_queries (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  glyph  TEXT NOT NULL,
  query  TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0,
  position REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE push_subscriptions (        -- one row per installed PWA/device
  id         TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  keys_json  TEXT NOT NULL,             -- p256dh + auth
  created_at TEXT NOT NULL
);
```

Notes:
- **IDs are strings (ULID).** Let clients generate IDs so offline-created records
  don't need a round-trip and never collide. ULIDs are time-sortable.
- **Soft delete (`deleted_at`)** so a delete on one device propagates to others
  instead of "reappearing" on next sync.
- The API hands the client the **same JSON shape** the store already uses
  (`{projects, tasks, labels, savedQueries}` with `labels` as an array of ids),
  so the existing Vue components and engines need minimal change.

---

## 4. API surface

A small REST API. The client keeps `Q` (query) and `Rec` (recurrence) and runs
them locally exactly as today; the server just persists and serves state.

```
GET    /api/state                 → { projects, tasks, labels, savedQueries, serverTime }
                                    (replaces hydrate-from-localStorage)

POST   /api/tasks                  create        (client sends id)
PATCH  /api/tasks/:id              partial update
DELETE /api/tasks/:id              soft delete (+ cascade subtasks)
POST   /api/tasks/:id/toggle       toggle done; if recurring, server spawns next
                                    occurrence (authoritative) and returns it

POST/PATCH/DELETE /api/projects/:id
POST/PATCH/DELETE /api/labels/:id
POST/PATCH/DELETE /api/saved-queries/:id

POST   /api/push/subscribe         store a Web Push subscription
GET    /api/changes?since=<ts>     (sync phase) records changed since timestamp
```

**Why `toggle` is a dedicated server endpoint:** completing a recurring task
spawns the next occurrence. Doing that server-side (using the shared `Rec` engine)
means the spawn is reliable and the reminder scheduler always sees the new
occurrence, regardless of which device clicked the checkbox.

---

## 5. Recurrence & reminders (the reason to have a server at all)

Today "reminder" is just a date field with no delivery. With an always-on
container you get real notifications:

1. **Scheduler tick** (every minute): query tasks where `reminder <= now`,
   `done = 0`, not already notified.
2. For each, send a **Web Push** notification (`web-push` + VAPID) to every stored
   `push_subscription`. The PWA service worker shows it even when the app is closed.
3. Mark as notified (a `reminded_at` column, or an in-table flag) to avoid repeats.
4. Recurrence spawning happens on `toggle` via the shared `Rec.next(...)`, exactly
   as `data.js#toggleDone` does now — just moved server-side.

Web Push works on installed PWAs including **iOS 16.4+** (must be added to the
home screen). This is what turns reminders into something that actually pings your
phone. It **requires HTTPS** — see §7.

---

## 6. PWA & offline strategy (phased — don't over-build)

The prototype is already fully client-side, so "works offline" is mostly about not
*regressing* that when we add a server.

- **Manifest + icons** → installable on desktop and home screen.
- **Service worker**: cache the app shell (`index.html`, `styles.css`, `js/*`,
  Vue) so the UI loads instantly and offline.
- **Data, Phase 1 (online-first):** on load, `GET /api/state` into the existing
  store; mutations call the API and update the store optimistically. Keep the last
  good `/api/state` in IndexedDB so a cold offline open still shows your tasks
  (read-only-ish). On a tailnet that's up nearly always, this is plenty.
- **Data, Phase 2 (offline writes):** add a mutation **outbox** in IndexedDB —
  queue create/update/delete while offline, replay on reconnect.
  **Conflict policy: last-write-wins per record using `updated_at`** (single user,
  conflicts are rare and low-stakes). No CRDTs — not worth it here.

> Recommendation: ship Phase 1, live with it, only build Phase 2 if you actually
> hit "I needed to add a task with Tailscale down" often enough to care.

---

## 7. Networking: Tailscale + HTTPS (do this first — it unblocks the PWA)

The blocker most people miss: **service workers and Web Push require a secure
context (HTTPS or localhost).** Hitting the box at `http://100.x.y.z:3000` over
the tailnet is *not* secure context → no PWA install, no push.

**Solution: Tailscale Serve.** It terminates TLS with an automatically-provisioned,
valid cert on your `*.ts.net` MagicDNS name (e.g. `https://tasks.tailnet-name.ts.net`).
That gives you real HTTPS reachable only inside your tailnet — exactly the
combination this app needs.

```
# on the host running the container, expose the app on the tailnet over HTTPS:
tailscale serve --bg 3000          # proxies https://<host>.<tailnet>.ts.net → :3000
```

- Keep **Funnel off** unless you deliberately want public internet exposure — for a
  personal app, tailnet-only is the whole point and removes the need for app login.
- Because the tailnet is the auth boundary, **app-level auth is optional.** If you
  want belt-and-suspenders, add a single shared secret / Tailscale identity-header
  check later.

---

## 8. Docker deployment

Single small container; SQLite lives on a mounted volume so data survives rebuilds.

```
backend/
├── Dockerfile
├── package.json
├── src/            (server, routes, db, scheduler)
├── migrations/
└── shared/         (symlink/copy of recurrence.js + query.js, isomorphic build)
```

```yaml
# compose.yaml
services:
  tdx:
    build: ./backend
    restart: unless-stopped
    volumes:
      - ./data:/data            # /data/tdx.db (WAL)
    environment:
      - DB_PATH=/data/tdx.db
      - VAPID_PUBLIC_KEY=...
      - VAPID_PRIVATE_KEY=...
    ports:
      - "127.0.0.1:3000:3000"   # only localhost; Tailscale Serve fronts it
```

Two ways to attach Tailscale:
- **Host has Tailscale** (simplest): bind to `127.0.0.1:3000`, run
  `tailscale serve` on the host. Recommended for a home server.
- **Tailscale sidecar container** (`tailscale/tailscale` with `TS_AUTHKEY` +
  `TS_SERVE_CONFIG`) if you want the node self-contained / portable.

The Node server also serves the static `frontend/` build, so it's one origin —
no CORS, and the service worker scope is clean.

---

## 9. Keeping one copy of the engines

`recurrence.js` and `query.js` currently end with `window.Rec = ...` / `window.Q = ...`.
Make them **isomorphic** so the same file runs in the browser and Node:

```js
const api = { parse, evaluate, run, build, /* ... */ };
if (typeof module !== 'undefined') module.exports = api;   // Node
if (typeof window !== 'undefined') window.Q = api;         // browser
```

Then the server `require()`s them for `toggle`/recurrence and (optionally)
server-side validation, and the browser loads them via `<script>` exactly as now.
One source of truth, zero reimplementation.

---

## 10. Suggested build order

1. **Tailscale Serve + HTTPS** in front of a placeholder — confirm secure context
   on desktop and phone. (Unblocks everything PWA.)
2. **Schema + migrations + `GET /api/state`**, seed from the existing sample data.
3. **CRUD endpoints**; swap `data.js` persistence from `localStorage` to the API
   (Phase-1 online-first). Keep the engines client-side.
4. **PWA shell**: manifest, icons, service worker caching the app shell.
5. **`toggle` + server-side recurrence spawn** using the shared `Rec` engine.
6. **Reminders**: push subscribe endpoint, scheduler tick, Web Push.
7. **Dockerize** + compose + volume; deploy on the home server.
8. *(Optional)* **Phase-2 offline outbox** with last-write-wins.

Steps 1–4 get you a real, synced, installable app on all devices. 5–6 deliver the
firing reminders. 7 makes it durable. 8 only if you need offline writes.

---

## 11. Decisions for you

- **App login at all, or rely purely on the tailnet?** (I'd start with tailnet-only.)
- **Offline writes now or later?** (I'd defer Phase 2 until you feel the pain.)
- **Reminder granularity:** keep date-only, or move `reminder` to a full timestamp
  (so "remind at 9:00am") now that delivery is real? (Timestamp is a small change
  and much more useful.)
- **Node backend confirmed?** It's the recommendation specifically to reuse the
  recurrence/query engines; say the word if you'd rather a different language and
  I'll plan the reimplementation cost.
```
