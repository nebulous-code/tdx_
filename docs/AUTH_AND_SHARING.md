# Auth, Accounts & Sharing — design (D1 foundation, UX later)

> Status: **design for review.** Companion to `PLATFORM_ARCHITECTURE.md`. The driving constraint: the *ownership + sharing model* must be baked into the **D1 backend rewrite** (not bolted on later), because it changes the most foundational thing in the schema — today everything is hard-scoped to a single `user_id` (composite `(user_id, id)` PKs). The frontend can stay single-user for now; the backend must not have to be re-laid to add multi-user, sharing, assignment, and read-only tokens. "Don't build it a third time" = bake the model now, wire the UX later.

## Goals & use cases (yours)
- **Multiple users**, each with their own projects (and a **private list** that's never shared).
- **A project can be shared** across users.
- **A task can be assigned** to a user — distinct from its creator, and nullable (unassigned).
- **Read-only access** to a project, with two motivating consumers:
  - **AI agents** — codify what we do today (you trust I don't edit; instead the token simply can't): read-only token, no write permission.
  - **Portfolio site** — hit the API read-only, render your project progress reskinned to the site's theme, always up to date for free (same idea later for notes/events).
- **Assignment use case:** your wife keeps a private list, you keep a private list, an AI could keep one; some projects are **shared on creation**, and within a shared project she **assigns** you weekend chores.
- **Extends to events & notes** later — same ownership/sharing/assignment shape. For now: **provide the columns + endpoints even if the frontend doesn't use them yet.**
- **One account → all apps.** An account gets tasks, notes, calendar; use what you want, no gates/paywalls between them.
- **Usergroups / households** (the long-term piece): share to a *person* (your wife) or a *group* (family = wife + kids + parents) — especially useful for calendars. Sketch it now as first-class even if the UI is later.

---

## 1. Identity & accounts
One `users` row = one identity across every app. No per-app entitlement flags — having an account means you have tasks + notes + calendar. (The only "access" concept is **resource sharing**, below, not app gating.) An **AI agent or a service** (portfolio site) is just a user too — possibly a dedicated bot user — that you grant read-only access to your resources. That keeps "agent can see my data" inside the same model as "my wife can see my data," not a special case.

## 2. The ownership shift (the foundational change)
Today: every row is scoped by `user_id` and that *is* the access model. To share, **ownership and access must split**:
- Each shareable resource gets an **`owner_id`** (the creator/owner) instead of being keyed by `user_id`.
- **IDs become globally unique UUIDs** (decided) — a shared project is referenced by several users, so per-user prefixed ids and the `seq` high-water-mark trick from the soft-delete work go away. Painful to retrofit, hence done in D1.
- **Tasks inherit access from their project.** The unit of sharing is the **project** (later: a calendar, a note folder) — you don't ACL every task; access to a task = access to its project (+ assignment). This keeps the permission surface small.

Default behavior is unchanged for today's single user: they own everything, there are no grants, so every access check resolves to "owner → full access." The current app behaves identically; the machinery is just present.

## 3. Sharing model — one ACL/grant table
One table grants a **principal** a **role** on a **resource** — generic so it extends to events/notes/calendars without redesign:
```
grants(id, resource_type, resource_id, principal_type, principal_id, role, created_at)
  resource_type  : 'project'        (later: 'calendar', 'note-folder', …)
  principal_type : 'user' | 'group'
  role           : 'viewer'  (read-only)  |  'editor'  (read+write)  |  'owner'
```
**Access check** (the one chokepoint every read/write goes through): `canAccess(user, resource, action)` = user is the resource's `owner_id` **OR** a `grant` exists — directly for that user, or via a group they belong to — whose `role` permits the action. Tasks resolve through their project. Read-only = a `viewer` grant; an agent/portfolio token with only viewer grants literally cannot write.

**Default is private** (no grants on create); sharing is opt-in (later, a create-with-sharing affordance in the UI). One consequence to honor: **duplicating a shared project yields a *private* copy** — grants don't carry over, so a duplicate has to be re-shared intentionally (no accidental leak via duplicate).

## 4. Assignment
`tasks.assignee_id` (nullable) — **distinct from `creator_id` and from the project `owner_id`.** Your wife (an `editor` on the shared "chores" project) creates tasks there and sets `assignee_id` = you. Assignment is a *task attribute*, not an access grant; the assignee should already have project access (so assigning within a shared project is the normal path). The query engine gets an `assignee:` predicate (`assignee:me`, `assignee:none`) so "my honey-do list" is just a saved query over shared projects. (We keep `creator_id` too, so "created by" vs "assigned to" are both displayable.)

## 5. Principals & usergroups / households
- `users` (exists). 
- `groups(id, name, owner_id, created_at)` — a household / usergroup. 
- `group_members(group_id, user_id, role)` — `role` ∈ member | admin.
- A `grant`'s `principal` can be a **user or a group**, so "share with my family" = one grant to the family group; everyone in it inherits the role. Add/remove a family member = group membership change, not re-sharing every project. This is the clean long-term answer to "share to my wife vs share to my whole family," and calendars are the obvious payoff. It's first-class in the schema from day one even if the management UI lands much later.

## 6. Credentials (no JWT)
Two credential types, **both opaque + server-side + revocable** (you value revocation; we avoid JWT precisely because it can't be revoked — self-hosted lowers the stakes, but revocable is simply the better default and costs us nothing):
- **Browser → session cookie** (the current `sessions` table: store `hash(token)`, look up server-side). Unchanged.
- **CLI / MCP / agent / portfolio → API token (PAT):** `api_tokens(id, user_id, name, token_hash, scopes, created_at, last_used_at, revoked_at)`. Opaque, hashed at rest, revocable (set `revoked_at`), and **scoped**. Issued from the account screen; one per consumer (one for the CLI, one per agent, one for the portfolio site) so you can revoke them independently.

Both resolve a request to the same `(user, scopes)` context, so every downstream check is identical regardless of how you authenticated.

## 7. Authorization — the layers a request passes
1. **Authentication** — who are you? (session or PAT → a `user`).
2. **Token scope** (PATs only) — what may this *credential* do at all? e.g. `read`, `write`, per-domain (`tasks:read`). A read-only agent token carries only `read` scopes. (Sessions are full-scope.)
3. **Resource authorization** — may this *user* touch this *resource*? the `canAccess` ACL check (§3).
4. **Role/action** — what the role permits (viewer = read; editor = read/write; assignment/complete vs delete can be role-gated later).

A read-only consumer is "blocked" twice over: the token has no write scope **and** the grants are only `viewer`. That's the codified version of "I just don't give you permission to edit."

## 8. Read-only consumers, concretely
- **AI agent:** a (possibly dedicated bot) user + a PAT with `read` scope + `viewer` grants on the projects you choose. It can `query` and read but not mutate. The MCP server (`PLATFORM_ARCHITECTURE.md` §9) passes this token through — agents go through the same checks as everyone.
- **Portfolio site:** a PAT with `read` scope + `viewer` grants on the projects you want public-ish. The site calls `GET /api/query` (e.g. `project:foo status:open`), reskins, done. Same path will work for notes/events.

## 9. Extends to events & notes (provide now, wire later)
The exact same `owner_id` + `grants` + `assignee_id` shape applies to events, notes (note folders), and calendars. Per your call: **add the columns and endpoints now** (so the contract and schema are complete and multi-user-ready) even though only tasks have a UI in D1. New domains in D2 then just *use* the existing ownership/sharing/assignment machinery — no auth rework.

## 10. Schema sketch (the new/changed pieces)
```
users(id, username, email, password_hash, is_admin, … prefs)        -- exists
groups(id, name, owner_id, created_at)                              -- NEW (household)
group_members(group_id, user_id, role, created_at)                 -- NEW

projects(id PK global, owner_id, name, …)                          -- user_id → owner_id; id global
tasks(id PK global, project_id, creator_id, assignee_id NULL, …)   -- + creator_id, assignee_id
-- (events, notes carry owner_id + assignee_id later, same pattern)

grants(id, resource_type, resource_id, principal_type, principal_id, role, created_at)   -- NEW ACL
sessions(id=hash(token), user_id, expires_at, last_seen)           -- exists (browser)
api_tokens(id, user_id, name, token_hash, scopes, created_at, last_used_at, revoked_at)  -- NEW (PATs)
```
Endpoints (contract-complete in D1, some UI-less): grant/revoke share, set/clear assignee, create/revoke API token, list "shared with me", group CRUD + membership, and an **admin-only `POST /api/admin/users`** to create users (replaces today's `add-user.js` script; no UI yet). The **access check is middleware** on every resource route, so nothing reaches the DB unauthorized.

## 11. Timing & deployment
- **In D1 (foundational — must do now):** the ownership shift (`owner_id`, global ids, the `canAccess` middleware), the `grants` table, `assignee_id`/`creator_id`, `api_tokens`, `groups`/`group_members` tables. Default everything to **single-user, private, no grants** so the existing app is byte-for-byte unchanged in behavior. **Migration:** existing prod rows → `owner_id` = the one current user, no grants; ids made globally unique.
- **Wired later (frontend + UX, no backend rebuild):** the sharing UI, the assignment UI, group management, the token-issuance screen, multi-user onboarding, agent/portfolio setup.
- **Deployment approach (suggestion):** fold the auth/ownership *model* into the D1 rewrite itself rather than as a follow-on phase — it's the scoping layer, so it can't cleanly be a separate step. Ship the endpoints contract-complete (even if the frontend ignores most of them), deploy, and **daily-drive as a single-user app on a multi-user-ready backend.** That satisfies "don't rebuild a third time": adding real sharing later is frontend wiring + turning on UI, not a backend re-lay.

## 12. Open seam — vault backup attribution (resolve when notes sharing ships)

The notes vault is laid out per-owner (`/vault/<owner>/…`), and its backup (see [`VAULT_BACKUP.md`](VAULT_BACKUP.md)) snapshots the **whole `/vault` as a single git repo**, committing as the sole owner's username. That's correct and simplest while tdx is single-user, but it doesn't cleanly attribute history once a vault holds multiple owners' subtrees — one scheduled snapshot would span several owners in a single commit.

When notes sharing / multi-user editing is wired, resolve it one of two ways: **per-owner commits** (stage and commit each owner's subtree separately within a snapshot tick, so each commit carries the right author), or **per-owner repos** (`/backups/<owner>.git` over `/vault/<owner>`). Per-owner repos also line up with per-user *permanent delete* ([`VAULT_VERSION_CONTROL.md`](VAULT_VERSION_CONTROL.md) Feature B), since a history rewrite would then be scoped to one user's history rather than the shared one.

This is recorded here so the MVP's single-repo choice stays a conscious, revisitable boundary — not a forgotten assumption. It's a backup/attribution detail only; it does **not** affect the ownership/grants model above (the vault files already sit under per-owner paths, which is all the access model needs).

## Decisions (resolved)
1. **IDs = UUIDs** — global, no per-user counter coordination.
2. **Roles = `viewer` / `editor` / `owner`** — coarse on purpose; extend later if a finer grade is ever needed.
3. **Assignee must already be a project member** — assignment is never a back-door to access.
4. **Default private** (no grants on create); opt-in sharing later. **Duplicating a shared project yields a private copy** (re-share intentionally). The per-user inbox stays the always-private default.
5. **PAT scopes reserved per-domain** (`tasks:read`, `notes:read`, …) even if we only exercise `read`/`write` at first.
6. **Adding users = an admin-only endpoint** (`POST /api/admin/users`), built in D1, no UI yet — replaces the current `add-user.js` script.
7. **Owner is fixed = creator** for now (no transfer).
