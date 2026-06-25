// seed-dev.ts — (re)build the dev database (server/data/tdx.dev.db) with a fixed
// dev user and a realistic, "presses all the buttons" set of sample data:
// projects (a tree, colors, glyphs, health), tasks (every due variation, labels,
// priorities, fib sizes, recurrence, subtasks, done, notes, reminders), labels,
// a saved view, and events (all-day, timed, weekly, monthly). Due dates are
// relative to *today* so it always looks fresh. Never touches prod.
//
//   Login:  dev / Password123!

import 'dotenv/config';
import fs from 'node:fs';
import { DEFAULT_DB_PATH, openDatabase } from '../src/db.js';
import { createUser } from '../src/seed.js';
import { createEvent } from '../src/services/events.js';
import { createLabel } from '../src/services/labels.js';
import { createProject } from '../src/services/projects.js';
import { createSavedQuery } from '../src/services/savedQueries.js';
import { createTask } from '../src/services/tasks.js';

const dbPath = DEFAULT_DB_PATH; // server/.env → data/tdx.dev.db (relative to server/)
for (const ext of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(dbPath + ext);
  } catch {
    /* not there — fine */
  }
}

const { db, sqlite } = openDatabase(dbPath); // fresh file → applies 001 + 002 migrations

// ---- date helpers (local time, relative to today) --------------------------
const today = new Date();
const ymd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const d = (n: number) => {
  const x = new Date(today);
  x.setDate(x.getDate() + n);
  return ymd(x);
};
const offToWeekday = (target: number) => (target - today.getDay() + 7) % 7; // 0=Sun..6=Sat
const monthFirst = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

async function main() {
  const user = await createUser(db, {
    username: 'dev',
    email: 'dev@local.test',
    password: 'Password123!',
  });
  const owner = user.id;
  // turn on Fibonacci sizing so size badges render in the UI
  await db.updateTable('users').set({ fib_sizing: 1 }).where('id', '=', owner).execute();

  // inbox project + the 6 system views were created by createUser → seedUserDefaults
  const inbox = (await db
    .selectFrom('projects')
    .select('id')
    .where('owner_id', '=', owner)
    .where('name', '=', 'inbox')
    .executeTakeFirst())!.id;

  // ---- labels (one pinned) ----
  const lab: Record<string, string> = {};
  for (const [name, pinned] of [
    ['urgent', true],
    ['quick', false],
    ['errand', false],
    ['bug', false],
    ['idea', false],
    ['deep-work', false],
  ] as const) {
    lab[name] = (await createLabel(db, owner, { name, pinned })).id;
  }

  // custom saved view (on top of the 6 system ones)
  await createSavedQuery(db, owner, {
    name: 'Urgent',
    glyph: '★',
    query: 'label:urgent status:open',
    pinned: true,
  });

  // ---- projects (a tree: colors, glyphs, a collapsed one, health checks) ----
  const home = await createProject(db, owner, {
    name: 'Home',
    color: '#ff9f43',
    glyph: '☰',
    health: ['no-due', 'no-tag', 'overdue'],
  });
  const garden = await createProject(db, owner, {
    name: 'Garden',
    parentId: home.id,
    color: '#46d369',
    glyph: '✦',
  });
  const finance = await createProject(db, owner, {
    name: 'Finance',
    parentId: home.id,
    color: '#b6c948',
    glyph: '§',
    collapsed: true,
  });
  const work = await createProject(db, owner, { name: 'Work', color: '#3fd7d7', glyph: 'λ' });
  const tdx = await createProject(db, owner, {
    name: 'tdx-app',
    parentId: work.id,
    color: '#5b8cff',
    glyph: '◈',
  });
  const reading = await createProject(db, owner, { name: 'Reading', color: '#ffb000', glyph: '¶' });

  const t = (over: Parameters<typeof createTask>[2]) => createTask(db, owner, over);

  // inbox — due today / overdue / no-due / done
  await t({
    projectId: inbox,
    title: 'Buy groceries',
    due: d(0),
    labels: [lab.errand, lab.quick],
    priority: 1,
    size: 2,
    notes: 'milk, eggs, bread',
  });
  await t({
    projectId: inbox,
    title: 'Call dentist for an appointment',
    due: d(-2),
    labels: [lab.urgent],
    priority: 4,
  });
  await t({
    projectId: inbox,
    title: 'Plan the weekend hike',
    labels: [lab.idea],
    size: 5,
    notes: 'somewhere with a view',
  });
  await t({ projectId: inbox, title: 'Renew library card', done: true, due: d(-3) });

  // garden — recurring + a reminder
  await t({
    projectId: garden.id,
    title: 'Water the tomatoes',
    due: d(0),
    recurrence: 'every 3 days',
    labels: [lab.quick],
    size: 1,
    reminder: `${d(0)}T07:30`,
  });
  await t({
    projectId: garden.id,
    title: 'Fix the leaky kitchen faucet',
    due: d(2),
    labels: [lab.errand],
    priority: 3,
    size: 8,
  });

  // finance — monthly recurrence, far-out due
  await t({
    projectId: finance.id,
    title: 'Pay rent',
    due: monthFirst,
    recurrence: 'monthly on day 1',
    labels: [lab.urgent],
    priority: 5,
    size: 1,
  });
  await t({ projectId: finance.id, title: 'Review subscriptions', due: d(20), size: 3 });

  // work / tdx-app — a parent with subtasks (one done), recurrence, bug label
  const ship = await t({
    projectId: tdx.id,
    title: 'Ship the recurrence builder UI',
    due: d(0),
    labels: [lab['deep-work']],
    priority: 3,
    size: 13,
    notes: 'builder writes syntax; syntax editable by hand',
  });
  await t({
    projectId: tdx.id,
    parentId: ship.id,
    title: 'Parse "every Nth weekday" form',
    done: true,
  });
  await t({ projectId: tdx.id, parentId: ship.id, title: 'Live next-3-occurrences preview' });
  await t({
    projectId: tdx.id,
    parentId: ship.id,
    title: 'Reuse syntax across tasks',
    labels: [lab.quick],
  });
  await t({
    projectId: tdx.id,
    title: 'Fix scanline flicker on Safari',
    due: d(3),
    labels: [lab.bug],
    priority: 2,
    size: 5,
  });
  await t({
    projectId: tdx.id,
    title: 'Weekly review',
    due: d(offToWeekday(5)),
    recurrence: 'weekly on fri',
    size: 2,
  });

  // reading — parent + chapters, far due, weekly recurrence
  const book = await t({
    projectId: reading.id,
    title: 'Finish "The Pragmatic Programmer"',
    due: d(25),
    labels: [lab.idea],
    size: 8,
  });
  await t({ projectId: reading.id, parentId: book.id, title: 'Ch. 7 — bend or break' });
  await t({ projectId: reading.id, parentId: book.id, title: 'Ch. 8 — pragmatic projects' });
  await t({
    projectId: reading.id,
    title: 'Weekly reading hour',
    due: d(offToWeekday(6)),
    recurrence: 'weekly on sat',
  });

  // ---- events — all-day / timed / weekly / monthly (anchored to this month) ----
  const e = (over: Parameters<typeof createEvent>[2]) => createEvent(db, owner, over);
  await e({
    title: 'Team standup',
    startAt: `${monthFirst}T09:00`,
    allDay: false,
    recurrence: 'weekly on mon,wed,fri',
    location: 'Zoom',
  });
  await e({
    title: 'Gym',
    startAt: `${monthFirst}T18:00`,
    allDay: false,
    recurrence: 'every 2 days',
  });
  await e({ title: 'Pay rent', startAt: monthFirst, allDay: true, recurrence: 'monthly on day 1' });
  await e({
    title: 'Dentist appointment',
    startAt: `${d(5)}T14:30`,
    allDay: false,
    location: 'Downtown Dental',
  });
  await e({ title: 'Project deadline', startAt: d(12), allDay: true });

  sqlite.close();
  console.log(`✓ seeded dev DB → ${dbPath}`);
  console.log('  login:  dev  /  Password123!');
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
