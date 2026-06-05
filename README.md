# tdx_

A keyboard-first, terminal-styled personal task manager. Projects as a tree,
tasks as queryable records, recurrence as a small reusable syntax, and a command
palette (`⌘K`) as the primary way to get around. Dark mode only, CRT/amber aesthetic.

Self-hosted: a **Node/Fastify backend** with a **SQLite** store serves the Vue 3
frontend and a small JSON API, runs in **Docker**, is reached over a **Tailscale
tailnet**, and is installable as a **PWA** with reminder notifications via Web Push.
Architecture and rationale: [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) (see §0
for what Phase 1 actually built).

## Layout

```
.
├── compose.yaml           Docker Compose (binds localhost; Tailscale fronts it)
├── docs/                  Design + handoff docs
│   ├── DESIGN_DOC.md        Product brief, features, data model, scope
│   ├── STYLE_GUIDE.md       Visual system, tokens, components, keyboard model
│   ├── BACKEND_PLAN.md      Backend architecture (§0 = as-built Phase 1)
│   └── screenshots/         UI captures
├── backend/               Node/Fastify API + SQLite + Web Push scheduler
│   ├── src/
│   │   ├── server.js        Fastify: serves ../frontend + /api, starts scheduler
│   │   ├── db.js            SQLite open, migrations, first-run seed (inbox + views)
│   │   ├── state.js         snapshot <-> rows; optimistic-concurrency version
│   │   ├── push.js          web-push (VAPID) wrapper
│   │   ├── scheduler.js     60s tick: fire due reminder notifications
│   │   └── routes/          state.js, push.js
│   ├── migrations/001_init.sql
│   ├── Dockerfile
│   └── .env.example
└── frontend/              Vue 3 app (no build step)
    ├── index.html           App shell, keyboard handler, API persistence, PWA wiring
    ├── styles.css           Full CRT/amber design system
    ├── manifest.webmanifest, sw.js, icons/
    └── js/
        ├── vue.global.prod.js   vendored Vue (same-origin, cacheable offline)
        ├── recurrence.js    window.Rec — pure recurrence engine
        ├── query.js         window.Q   — pure query engine
        ├── data.js          window.store — reactive store + mutations
        └── …                sidebar, tasklist, task-detail, query-bar, command-palette, modals, recurrence-builder
```

## Run locally (development)

```sh
cd backend
cp .env.example .env        # then: npm run gen-vapid  and paste the keys into .env
npm install
npm start                   # serves the whole app at http://localhost:3000
```

Open <http://localhost:3000>. State persists to SQLite at `data/tdx.db` (the path is
configurable via `DB_PATH`; defaults under the repo `data/` dir). On first run the DB
is seeded with a single `inbox` project plus the built-in smart-views.

> Service workers and Web Push require a **secure context** (HTTPS or `localhost`).
> `localhost` works for dev; for phone/desktop over the tailnet you need HTTPS — see below.

## Deploy (Docker + Tailscale)

```sh
# 1) generate VAPID keys and put them in backend/.env (PORT/TZ/VAPID_*)
cd backend && cp .env.example .env && npm run gen-vapid   # paste keys into .env
# 2) build + run; data persists in ./data, port bound to localhost only
cd .. && docker compose up -d
# 3) expose over the tailnet with valid HTTPS (run on the host with Tailscale)
tailscale serve --bg 3000     # -> https://<host>.<tailnet>.ts.net
```

Then open `https://<host>.<tailnet>.ts.net` on desktop/phone, install it (Add to Home
Screen on iOS 16.4+), and tap **◔ notify** in the top bar to enable reminders. Keep
Tailscale **Funnel off** — tailnet-only is the security model (no app login).

## How persistence works (one-paragraph version)

The frontend keeps the whole app state in a reactive store and, on any change
(debounced), PUTs the entire snapshot to `/api/state`; on load it GETs it back. The
server mirrors the snapshot into normalized SQLite tables and guards concurrent writes
with a version counter (`409` → resync). Reminders are timestamps; a server-side
scheduler sends a Web Push when one comes due, even if the app is closed. Details and
trade-offs (why snapshot, not per-record) are in `docs/BACKEND_PLAN.md` §0.
