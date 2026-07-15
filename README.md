# tdx_

A keyboard-first, terminal-styled personal task manager. Projects as a tree,
tasks as queryable records, recurrence as a small reusable syntax, and a command
palette (`⌘K`) as the primary way to get around. Dark mode only, CRT/amber aesthetic.

Self-hosted: a **Node/Fastify backend** with a **SQLite** store serves the Vue 3
frontend and a small JSON API, runs in **Docker**, and is reached at a plain
`http://host:port` over the LAN or a Tailscale tailnet.
Architecture and rationale: [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) (see §0
for what Phase 1 actually built).

> Reminder notifications (Web Push) were prototyped and then removed — they
> required an HTTPS secure context, which conflicts with serving over a simple
> `ip:port`. Reminders are still stored and shown; they just don't push. This may
> come back later.

## Layout

```
.
├── compose.yaml           Docker Compose (binds localhost; Tailscale fronts it)
├── docs/                  Design + handoff docs
│   ├── DESIGN_DOC.md        Product brief, features, data model, scope
│   ├── STYLE_GUIDE.md       Visual system, tokens, components, keyboard model
│   ├── BACKEND_PLAN.md      Backend architecture (§0 = as-built Phase 1)
│   └── screenshots/         UI captures
├── backend/               Node/Fastify API + SQLite
│   ├── src/
│   │   ├── server.js        Fastify: serves ../frontend + /api/state
│   │   ├── db.js            SQLite open, migrations, first-run seed (inbox + views)
│   │   ├── state.js         snapshot <-> rows; strict optimistic-concurrency version
│   │   └── routes/state.js  GET/PUT /api/state
│   ├── migrations/001_init.sql
│   ├── Dockerfile
│   └── .env.example
└── frontend/              Vue 3 app (no build step)
    ├── index.html           App shell, keyboard handler, API persistence
    ├── styles.css           Full CRT/amber design system
    ├── icons/
    └── js/
        ├── vue.global.prod.js   vendored Vue (same-origin)
        ├── recurrence.js    window.Rec — pure recurrence engine
        ├── query.js         window.Q   — pure query engine
        ├── data.js          window.store — reactive store + mutations
        └── …                sidebar, tasklist, task-detail, query-bar, command-palette, modals, help-modal, recurrence-builder
```

## Run locally (development)

```sh
cd backend
cp .env.example .env        # optional; defaults are fine for local dev
npm install
npm start                   # serves the whole app at http://localhost:3000
```

Open <http://localhost:3000>. State persists to SQLite at `data/tdx.db` (the path is
configurable via `DB_PATH`; defaults under the repo `data/` dir). On first run the DB
is seeded with a single `inbox` project plus the built-in smart-views.

## Deploy (Docker)

**Local / dev** — build and run from source:

```sh
docker compose up -d --build
```

**Host / production** — pull the image CI publishes to GHCR (no local build):

```sh
docker compose pull && docker compose up -d
```

CI (`.github/workflows/docker.yml`) builds and pushes `ghcr.io/nebulous-code/tdx:latest`
(plus a per-commit `:<sha>` tag) on every push to `main`. `compose.yaml` references that
image; the `build:` block is only used when you pass `--build` locally.

> One-time: after the first workflow run, set the GHCR **tdx** package visibility to
> **Public** (GitHub → your packages → tdx → Package settings) so the host can pull it
> without credentials.

**Hands-off updates** — run Watchtower once on the host:

```sh
docker compose -f compose.watchtower.yml up -d
```

It polls GHCR every 5 minutes and auto-pulls/restarts the `tdx` container when a new
`:latest` is published (data in `./data` is untouched).

The container publishes port 3000 on all interfaces, so reach it at
`http://<host-ip>:3000` from any device on the same LAN or tailnet. Data persists in
`./data`. Set `TZ` in `compose.yaml` to your local timezone. There's no app login, so
keep it on a trusted network (a tailnet, or LAN behind your firewall) — and keep
Tailscale **Funnel off**.

## Backups & restore

Backups are scheduled from the app (admin: **@ account → backups**) and protect both halves of your data with one switch:

- **The database** (tasks, events, projects, labels, saved queries, note metadata) → a standalone SQLite snapshot `tdx-<timestamp>.db`.
- **The notes vault** (the `.md` files and attachments — the note content) → committed into a `vault.git` repository, so you get point-in-time history, not just the latest copy. In-app edits also commit within a few seconds.

Set a backup directory (an absolute, writable path — a mounted volume like `/backups` in production) and turn backups on; both artifacts land there side by side.

**Restoring** is a documented runbook, not a UI button — see [`RESTORE.md`](RESTORE.md): §1–§3 for the database (stop → swap the file → start) and §4 for the notes vault (check the file out of `vault.git`, then sync). Design and rationale: [`docs/BACKUP_DESIGN.md`](docs/BACKUP_DESIGN.md) (database) and [`docs/VAULT_BACKUP.md`](docs/VAULT_BACKUP.md) (vault).

## How persistence works (one-paragraph version)

The frontend keeps the whole app state in a reactive store and, on any change
(debounced), PUTs the entire snapshot to `/api/state`; on load it GETs it back. The
server mirrors the snapshot into normalized SQLite tables and guards concurrent writes
with a strict version counter (`409` → resync; a write with a missing/stale version is
always rejected, never force-applied). The client only writes after a successful load,
so a device that can't reach the server stays read-only instead of overwriting good
state. Details and trade-offs (why snapshot, not per-record) are in
`docs/BACKEND_PLAN.md` §0.
