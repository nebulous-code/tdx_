// Branch-fill tests for the leftover conditionals in src/services/notes.ts
// (and a couple of edge cases for src/services/events.ts). These complement
// notes.test.ts / events*.test.ts by hitting the specific arms those suites
// leave cold: walkMd's dotfile + symlink skips, scanVault's incremental
// mtime-skip vs. the unknown-path arm, deletion-detection's note_links cleanup,
// resolveNoteName resolving by FILENAME (not title), reconcileFileLinks' self-
// link skip, tombstone-then-restore, frontmatter with/without extra keys, and
// migrateVaultLayout's flat==dest / dest-already-exists skip arms.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../src/seed.js';
import { createEvent, eventsInRange } from '../src/services/events.js';
import {
  createNote,
  deleteNote,
  getNote,
  migrateVaultLayout,
  scanFile,
  scanVault,
} from '../src/services/notes.js';
import { createTask } from '../src/services/tasks.js';
import { buildTestApp, createAndLogin } from './support/app.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
let vault: string;
let ownerId: string;

const vp = (rel: string) => path.join(vault, ownerId, rel);

before(async () => {
  // VAULT_DIR must be set BEFORE buildTestApp so the vault helpers (read lazily)
  // resolve to our temp dir from the first scan onward.
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-fill-vault-'));
  process.env.VAULT_DIR = vault;
  ctx = await buildTestApp();
  app = ctx.app;
  const li = await createAndLogin(app, ctx.db);
  ownerId = li.user.id;
});
after(async () => {
  await app.close();
  fs.rmSync(vault, { recursive: true, force: true });
});

// ---- walkMd: dotfiles and symlinks are skipped -----------------------------

test('scanVault skips dotfiles, dot-dirs, and symlinked .md files', async () => {
  const root = vp('.'); // owner root (ensure it exists via a real note first)
  await createNote(ctx.db, ownerId, { title: 'Anchor', body: 'real note' });

  // a dotfile .md at the root → walkMd's `ent.name.startsWith('.')` skip
  fs.writeFileSync(path.join(root, '.hidden.md'), '# hidden\n\nnot indexed');
  // a dot-DIR (e.g. .obsidian) holding a .md → same skip arm, on a directory
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(root, '.obsidian', 'workspace.md'), '# config');
  // a symlink that ends in .md → `ent.isSymbolicLink()` skip
  const targetOutside = path.join(vault, 'outside-target.md');
  fs.writeFileSync(targetOutside, '# outside\n\nshould not be followed');
  try {
    fs.symlinkSync(targetOutside, path.join(root, 'link.md'));
  } catch {
    /* symlinks may be unsupported on some filesystems — the dotfile arms still run */
  }

  const before = await scanVault(ctx.db, ownerId, 'full');
  // none of the skipped entries became notes
  const all = await ctx.db
    .selectFrom('notes')
    .select(['path'])
    .where('owner_id', '=', ownerId)
    .where('tombstoned', '=', 0)
    .execute();
  const paths = all.map((r) => r.path);
  assert.ok(!paths.includes('.hidden.md'));
  assert.ok(!paths.some((p) => p.startsWith('.obsidian')));
  assert.ok(!paths.includes('link.md'));
  assert.ok(before.scanned >= 1); // the real Anchor note was still scanned
});

// ---- scanVault incremental: mtime-skip vs. unknown-path arm ------------------

test('incremental sync skips an unchanged known file but scans a brand-new one', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Steady', body: 'v1' });
  // settle so the row's mtime matches the file on disk
  await scanVault(ctx.db, ownerId, 'incremental');

  // a NEW file the DB has never seen → byPath.get() is undefined → knownMtime falsy
  // → scanned (not skipped). Use a unique, distant mtime so equality can't accidentally hold.
  fs.writeFileSync(vp('brand-new.md'), '# Brand New\n\nfresh content');

  const sum = await scanVault(ctx.db, ownerId, 'incremental');
  // the new file was indexed; Steady (unchanged mtime) was skipped via continue
  assert.ok(sum.updated >= 1);
  const fresh = await ctx.db
    .selectFrom('notes')
    .select(['path'])
    .where('owner_id', '=', ownerId)
    .where('tombstoned', '=', 0)
    .execute();
  assert.ok(fresh.some((r) => r.path === 'brand-new.md'));

  // a true no-op pass: everything's mtime now matches → 0 updates (mtime-equal skip arm)
  const noop = await scanVault(ctx.db, ownerId, 'incremental');
  assert.equal(noop.updated, 0);
  assert.equal(noop.tombstoned, 0);
  // keep the linter happy that `note` is meaningful
  assert.ok(note.id);
});

test('incremental sync re-scans a KNOWN file whose mtime changed externally', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Mutated', body: 'gammaword orig' });
  await scanVault(ctx.db, ownerId, 'incremental'); // settle: row mtime == disk mtime

  // edit the file in place AND bump its mtime forward so the row's known mtime no
  // longer matches → `knownMtime` truthy but `=== knownMtime` false → it IS scanned.
  const p = vp(note.path);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('gammaword orig', 'deltaword new'));
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(p, future, future);

  const sum = await scanVault(ctx.db, ownerId, 'incremental');
  assert.ok(sum.updated >= 1); // the changed known file was re-indexed
  assert.equal((await getNote(ctx.db, ownerId, note.id))?.body, 'deltaword new');
});

test('a dangling [[Name]] wikilink resolves to null and materializes no edge', async () => {
  // resolveNoteName returns null → the `id && …` guard short-circuits on the falsy arm
  const src = await createNote(ctx.db, ownerId, {
    title: 'Dangler',
    body: 'points at [[A Note That Does Not Exist Anywhere]]',
  });
  const edges = await ctx.db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', src.id)
    .execute();
  assert.equal(edges.length, 0);
});

// ---- deletion detection cleans up note_links --------------------------------

test('scanVault tombstone removes the dead note row, its FTS, AND its note_links', async () => {
  const task = await createTask(ctx.db, ownerId, { title: 'link target' });

  // a note that materializes a content edge to the task → it owns a note_links row
  const note = await createNote(ctx.db, ownerId, {
    title: 'Linker',
    body: `points at [[task:${task.id}]]`,
  });
  const linksBefore = await ctx.db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', note.id)
    .execute();
  assert.equal(linksBefore.length, 1);

  // delete the file on disk, then sync → deletion-detection branch tombstones it
  fs.unlinkSync(vp(note.path));
  const sum = await scanVault(ctx.db, ownerId, 'incremental');
  assert.ok(sum.tombstoned >= 1);

  assert.equal(await getNote(ctx.db, ownerId, note.id), null);
  const linksAfter = await ctx.db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', note.id)
    .execute();
  assert.equal(linksAfter.length, 0); // note_links cleared by the tombstone arm
});

// ---- resolveNoteName: the FILENAME (path basename) arm of the OR -------------

test('a [[wikilink]] resolves by filename when the stored title differs', async () => {
  // createNote sets title === basename. Force them apart so resolveNoteName's
  // first OR arm (title match) fails and the second (path basename match) carries.
  const target = await createNote(ctx.db, ownerId, { title: 'Renamed Topic', body: 'body' });
  const fileBase = path.basename(target.path, '.md'); // 'Renamed Topic'
  await ctx.db
    .updateTable('notes')
    .set({ title: 'A Completely Different Stored Title' })
    .where('id', '=', target.id)
    .where('owner_id', '=', ownerId)
    .execute();

  // a source note links by the FILENAME, which no longer equals the stored title
  const src = await createNote(ctx.db, ownerId, {
    title: 'Source By Filename',
    body: `see [[${fileBase}]]`,
  });
  const edge = await ctx.db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', src.id)
    .where('target_id', '=', target.id)
    .executeTakeFirst();
  assert.ok(edge, 'wikilink resolved via the path-basename arm of resolveNoteName');
});

// ---- reconcileFileLinks: a self [[Name]] link is skipped --------------------

test('a note that wikilinks to its own name materializes no self-edge', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Narcissus', body: 'placeholder' });
  // rewrite the file so its body references its own filename, then re-scan it
  const fileBase = path.basename(note.path, '.md');
  const raw = fs.readFileSync(vp(note.path), 'utf8');
  fs.writeFileSync(vp(note.path), raw.replace('placeholder', `loves [[${fileBase}]]`));
  await scanFile(ctx.db, ownerId, note.path);

  const selfEdges = await ctx.db
    .selectFrom('note_links')
    .selectAll()
    .where('origin_note_id', '=', note.id)
    .where('target_id', '=', note.id)
    .execute();
  assert.equal(selfEdges.length, 0); // `id !== noteId` guard skipped the self-link
});

// ---- scanFile: re-scan of a tombstoned-then-restored file -------------------

test('re-creating a deleted file restores it via the existing-row update arm', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Phoenix', body: 'first life' });
  const id = note.id;
  await deleteNote(ctx.db, ownerId, id); // tombstones + removes the file
  assert.equal(await getNote(ctx.db, ownerId, id), null);

  // write the SAME frontmatter id back to disk and scan → existing-row branch flips
  // tombstoned back to 0 (the file was restored, not a fresh insert).
  fs.writeFileSync(vp('Phoenix.md'), `---\nid: ${id}\n---\n\nsecond life`);
  const restored = await scanFile(ctx.db, ownerId, 'Phoenix.md');
  assert.ok(restored);
  assert.equal(restored.id, id);
  assert.equal((await getNote(ctx.db, ownerId, id))?.body, 'second life');
});

// ---- scanFile: frontmatter with extra keys vs. none -------------------------

test('frontmatter with extra keys is stored as JSON; a bare id stores null', async () => {
  // extra keys → `Object.keys(parsed.frontmatter).length` truthy → JSON stored
  fs.writeFileSync(
    vp('with-extra.md'),
    '---\nid: 11111111-1111-1111-1111-111111111111\ncolor: blue\ntag: work\n---\n\nbody A',
  );
  const withExtra = await scanFile(ctx.db, ownerId, 'with-extra.md');
  assert.ok(withExtra);
  const rowA = await ctx.db
    .selectFrom('notes')
    .select(['frontmatter'])
    .where('id', '=', withExtra.id)
    .executeTakeFirstOrThrow();
  assert.ok(rowA.frontmatter);
  assert.deepEqual(JSON.parse(rowA.frontmatter as string), { color: 'blue', tag: 'work' });

  // only the managed id → no extra keys → frontmatter column is null
  fs.writeFileSync(
    vp('only-id.md'),
    '---\nid: 22222222-2222-2222-2222-222222222222\n---\n\nbody B',
  );
  const onlyId = await scanFile(ctx.db, ownerId, 'only-id.md');
  assert.ok(onlyId);
  const rowB = await ctx.db
    .selectFrom('notes')
    .select(['frontmatter'])
    .where('id', '=', onlyId.id)
    .executeTakeFirstOrThrow();
  assert.equal(rowB.frontmatter, null);
});

// ---- scanFile: a missing file returns null ----------------------------------

test('scanFile returns null when the file does not exist', async () => {
  assert.equal(await scanFile(ctx.db, ownerId, 'nonexistent-file.md'), null);
});

// ---- getNote / deleteNote: file-vanished catch arms -------------------------

test('getNote returns an empty body when the backing file vanished', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Vanisher', body: 'will disappear' });
  // remove the file but leave the (still-live) row → getNote's read throws → catch → ''
  fs.unlinkSync(vp(note.path));
  const got = await getNote(ctx.db, ownerId, note.id);
  assert.ok(got);
  assert.equal(got.body, '');
});

test('deleteNote tombstones even when the file is already gone', async () => {
  const note = await createNote(ctx.db, ownerId, { title: 'Halfgone', body: 'partial' });
  fs.unlinkSync(vp(note.path)); // file already removed → unlinkSync in deleteNote throws → catch
  const ok = await deleteNote(ctx.db, ownerId, note.id);
  assert.equal(ok, true); // tombstoned despite the missing file
  assert.equal(await getNote(ctx.db, ownerId, note.id), null);
});

// ---- migrateVaultLayout: flat==dest skip + dest-already-exists skip ---------

test('migrateVaultLayout skips rows already under their owner subdir and pre-existing dests', async () => {
  // A second owner whose note already lives in the proper subdir → flat===dest? No:
  // flat = base/<path>, dest = base/<owner>/<path>. They differ, but the flat copy
  // does NOT exist (file is already migrated) → the `fs.existsSync(flat)` guard skips.
  const bob = await createUser(
    ctx.db,
    { username: 'mig-bob', email: 'mig-bob@x.com', password: 'B0b!secret9' },
    { isAdmin: false },
  );
  const now = new Date().toISOString();

  // (a) already-migrated row: file exists ONLY under the owner subdir, never flat
  const migratedId = 'aaaaaaaa-0000-0000-0000-000000000001';
  await ctx.db
    .insertInto('notes')
    .values({
      id: migratedId,
      owner_id: bob.id,
      path: 'Already.md',
      title: 'Already',
      mtime: now,
      frontmatter: null,
      tombstoned: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  fs.mkdirSync(path.join(vault, bob.id), { recursive: true });
  fs.writeFileSync(path.join(vault, bob.id, 'Already.md'), `---\nid: ${migratedId}\n---\n\nok`);

  // (b) dest-already-exists row: BOTH a flat legacy file AND a same-named dest file
  // exist → `!fs.existsSync(dest)` is false → skip (no clobber of the existing dest).
  const collideId = 'aaaaaaaa-0000-0000-0000-000000000002';
  await ctx.db
    .insertInto('notes')
    .values({
      id: collideId,
      owner_id: bob.id,
      path: 'Collide.md',
      title: 'Collide',
      mtime: now,
      frontmatter: null,
      tombstoned: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  fs.writeFileSync(path.join(vault, 'Collide.md'), `---\nid: ${collideId}\n---\n\nflat legacy`);
  fs.writeFileSync(
    path.join(vault, bob.id, 'Collide.md'),
    `---\nid: ${collideId}\n---\n\nalready here`,
  );

  // (c) a genuine legacy move so migrate has at least one positive case too
  const moveId = 'aaaaaaaa-0000-0000-0000-000000000003';
  await ctx.db
    .insertInto('notes')
    .values({
      id: moveId,
      owner_id: bob.id,
      path: 'Move.md',
      title: 'Move',
      mtime: now,
      frontmatter: null,
      tombstoned: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  fs.writeFileSync(path.join(vault, 'Move.md'), `---\nid: ${moveId}\n---\n\nplease move me`);

  const moved = await migrateVaultLayout(ctx.db);
  assert.equal(moved, 1); // only Move.md was migrated

  // the genuine move landed in the subdir and left the flat base
  assert.ok(fs.existsSync(path.join(vault, bob.id, 'Move.md')));
  assert.ok(!fs.existsSync(path.join(vault, 'Move.md')));
  // the collide dest was preserved untouched (skip arm, no clobber)
  assert.match(fs.readFileSync(path.join(vault, bob.id, 'Collide.md'), 'utf8'), /already here/);
  // the flat collide legacy file is left in place (not moved)
  assert.ok(fs.existsSync(path.join(vault, 'Collide.md')));
});

// ---- events.ts: occurrences exactly on the window edges ---------------------

test('eventsInRange includes a recurring occurrence landing exactly on the to-edge', async () => {
  const ev = await createEvent(ctx.db, ownerId, {
    title: 'edge daily',
    startAt: '2030-04-10T09:00',
    recurrence: 'daily',
  });
  // window's last day is exactly an occurrence day (d <= toD boundary)
  const occ = await eventsInRange(ctx.db, ownerId, '2030-04-10', '2030-04-12');
  const dates = occ.filter((o) => o.id === ev.id).map((o) => o.date);
  assert.deepEqual(dates, ['2030-04-10', '2030-04-11', '2030-04-12']);
});

test('eventsInRange includes a one-off whose start equals the from-edge', async () => {
  const ev = await createEvent(ctx.db, ownerId, {
    title: 'on the from edge',
    startAt: '2030-05-01T09:00',
  });
  const occ = await eventsInRange(ctx.db, ownerId, '2030-05-01', '2030-05-07');
  assert.deepEqual(
    occ.filter((o) => o.id === ev.id).map((o) => o.date),
    ['2030-05-01'],
  );
});
