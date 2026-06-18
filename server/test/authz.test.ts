import assert from 'node:assert';
import { after, before, test } from 'node:test';
import { accessLevel, canAccess } from '../src/authz.js';
import type { DB } from '../src/db.js';
import { newId } from '../src/ids.js';
import { createUser } from '../src/seed.js';
import { buildTestApp } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let db: DB;
let alice: { id: string };
let bob: { id: string };
const P = newId(); // alice's project
const P2 = newId(); // alice's second project (group-shared)
const T = newId(); // alice's task in P
const L = newId(); // alice's label
const G = newId(); // a group alice owns, bob is a member

const now = new Date().toISOString();
const proj = (id: string, owner: string) => ({
  id,
  owner_id: owner,
  parent_id: null,
  name: id,
  color: '#fff',
  glyph: '●',
  collapsed: 0,
  position: 0,
  archived: 0,
  health: '[]',
  created_at: now,
  updated_at: now,
});

before(async () => {
  ctx = await buildTestApp();
  db = ctx.db;
  alice = await createUser(db, { username: 'alice', email: 'a@x.com', password: 'Aaa!12345' });
  bob = await createUser(db, { username: 'bob', email: 'b@x.com', password: 'Bbb!12345' });
  await db
    .insertInto('projects')
    .values([proj(P, alice.id), proj(P2, alice.id)])
    .execute();
  await db
    .insertInto('tasks')
    .values({
      id: T,
      owner_id: alice.id,
      creator_id: alice.id,
      assignee_id: null,
      project_id: P,
      parent_id: null,
      title: 'a task',
      done: 0,
      due: null,
      reminder: null,
      recurrence: null,
      notes: '',
      priority: 0,
      size: 0,
      position: 0,
      archived: 0,
      created_at: now,
      completed_at: null,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('labels')
    .values({ id: L, owner_id: alice.id, name: 'urgent', pinned: 0 })
    .execute();
  await db
    .insertInto('groups')
    .values({ id: G, name: 'family', owner_id: alice.id, created_at: now })
    .execute();
  await db
    .insertInto('group_members')
    .values({ group_id: G, user_id: bob.id, role: 'member', created_at: now })
    .execute();
});
after(async () => {
  await ctx.app.close();
});

test('owner has full write access; non-owner has none by default', async () => {
  assert.equal(await accessLevel(db, alice, 'project', P), 'write');
  assert.equal(await accessLevel(db, alice, 'task', T), 'write');
  assert.equal(await accessLevel(db, bob, 'project', P), 'none');
  assert.equal(await accessLevel(db, bob, 'task', T), 'none');
});

test('a viewer grant gives read (and the task inherits it), but not write', async () => {
  await db
    .insertInto('grants')
    .values({
      id: newId(),
      resource_type: 'project',
      resource_id: P,
      principal_type: 'user',
      principal_id: bob.id,
      role: 'viewer',
      created_at: now,
    })
    .execute();
  assert.equal(await accessLevel(db, bob, 'project', P), 'read');
  assert.equal(await accessLevel(db, bob, 'task', T), 'read'); // inherited
  assert.equal(await canAccess(db, bob, 'task', T, 'read'), true);
  assert.equal(await canAccess(db, bob, 'task', T, 'write'), false);
});

test('upgrading the grant to editor grants write', async () => {
  await db
    .updateTable('grants')
    .set({ role: 'editor' })
    .where('resource_id', '=', P)
    .where('principal_id', '=', bob.id)
    .execute();
  assert.equal(await accessLevel(db, bob, 'project', P), 'write');
  assert.equal(await canAccess(db, bob, 'task', T, 'write'), true);
});

test('a group grant flows to its members', async () => {
  assert.equal(await accessLevel(db, bob, 'project', P2), 'none');
  await db
    .insertInto('grants')
    .values({
      id: newId(),
      resource_type: 'project',
      resource_id: P2,
      principal_type: 'group',
      principal_id: G,
      role: 'editor',
      created_at: now,
    })
    .execute();
  assert.equal(await accessLevel(db, bob, 'project', P2), 'write');
});

test('labels/saved-queries are owner-only (not shareable in D1)', async () => {
  assert.equal(await accessLevel(db, alice, 'label', L), 'write');
  assert.equal(await accessLevel(db, bob, 'label', L), 'none');
});

test('missing resource → none', async () => {
  assert.equal(await accessLevel(db, alice, 'task', newId()), 'none');
});
