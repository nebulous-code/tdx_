# tdx_

A keyboard-first, terminal-styled personal task manager. Projects as a tree,
tasks as queryable records, recurrence as a small reusable syntax, and a command
palette (`⌘K`) as the primary way to get around. Dark mode only, CRT/amber aesthetic.

Currently a **front-end prototype** (Vue 3, no build step, `localStorage` only).
The plan is to add a self-hosted backend (Docker + SQLite) reached over a tailnet,
installable as a PWA. See [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md).

## Layout

```
.
├── docs/                  Design + handoff docs
│   ├── DESIGN_DOC.md        Product brief, features, data model, scope
│   ├── STYLE_GUIDE.md       Visual system, tokens, components, keyboard model
│   ├── BACKEND_PLAN.md      Proposed backend architecture
│   └── screenshots/         UI captures
└── frontend/              The Vue 3 prototype (open index.html)
    ├── index.html           App shell, keyboard handler, persistence, wiring
    ├── styles.css           Full CRT/amber design system
    └── js/
        ├── recurrence.js    window.Rec — pure recurrence engine (parse/next/...)
        ├── query.js         window.Q   — pure query engine (parse/evaluate/run/build)
        ├── data.js          window.store — reactive store, sample data, mutations
        ├── sidebar.js       Smart-view list + recursive project tree
        ├── tasklist.js      Quick-add, list controls, recursive task rows
        ├── recurrence-builder.js  Guided recurrence editor
        ├── task-detail.js   Detail/edit drawer
        ├── query-bar.js     Text query input + visual builder
        ├── command-palette.js  ⌘K fuzzy palette
        └── modals.js        Project + save-query modals
```

## Run the prototype

It's a static, no-build app. Serve `frontend/` with any static server, e.g.:

```sh
cd frontend && python3 -m http.server 8080   # then open http://localhost:8080
```

(Opening `index.html` directly via `file://` also works; a server is only needed
once a service worker / PWA manifest is added.)
