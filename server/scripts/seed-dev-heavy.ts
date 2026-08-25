// seed-dev-heavy.ts — a HEAVYWEIGHT, prod-sized synthetic dataset for performance testing.
//
// All content is bogus/generated (no personal data), but the SHAPE and SIZE mirror prod
// (~2026-08): ~37 projects, ~68 labels, ~1025 tasks (250 open / 775 done, with subtree nesting,
// recurrence, labels, due-date spread, and completed dates spread over ~6 months), ~11 folders,
// ~124 notes, a few calendars/events, and some pinned saved views (to exercise the badge fan-out).
//
// Use it to pressure-test the app on a representative load without putting real data in dev:
//   npm run seed:dev:heavy            # ~prod scale
//   npm run seed:dev:heavy -- 3       # 3x prod scale (an extreme pressure test)
//   tools/dev.sh --reseed-heavy [N]   # reseed heavy then start dev
// The lighter hand-crafted seed stays available via `npm run seed:dev` / `tools/dev.sh --reseed`.
//
// Goes through the real services (createProject/createTask/createNote/…) so vault files, readable
// ids, label joins, and positions are all consistent. Login: dev / Password123! (theme: plasma,
// so dev is visually unmistakable from prod). DB: server/.env → data/tdx.dev.db.

import fs from 'node:fs';
import { DEFAULT_DB_PATH, openDatabase } from '../src/db.js';
import { createUser } from '../src/seed.js';
import { createCalendar } from '../src/services/calendars.js';
import { createEvent } from '../src/services/events.js';
import { createFolder } from '../src/services/folders.js';
import { createLabel } from '../src/services/labels.js';
import { createNote } from '../src/services/notes.js';
import { createProject } from '../src/services/projects.js';
import { createSavedQuery } from '../src/services/savedQueries.js';
import { createTask } from '../src/services/tasks.js';
import { vaultBase } from '../src/vault.js';

// SCALE multiplier (arg 1, default 1). 1 ≈ prod size; bump for a harsher pressure test.
const SCALE = Math.max(1, Number(process.argv[2]) || 1);

const dbPath = DEFAULT_DB_PATH;
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(vaultBase(), { recursive: true, force: true }); // clean vault so note files match the rows
const { db, sqlite } = openDatabase(dbPath); // fresh file → applies every migration

// ---- deterministic PRNG (mulberry32) so the dataset is reproducible run-to-run ----
let _s = 0x1a2b3c4d;
const rnd = () => {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const sample = <T>(a: T[], k: number): T[] => {
  const out: T[] = [];
  for (let i = 0; i < k && a.length; i++) out.push(pick(a));
  return [...new Set(out)];
};

// ---- date helpers (relative to today, like seed-dev) ----
const today = new Date();
const ymd = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const d = (n: number) => {
  const x = new Date(today);
  x.setDate(x.getDate() + n);
  return ymd(x);
};

// ---- bogus content pools (all generic, non-personal) ----
const VERBS = [
  'Review',
  'Update',
  'Fix',
  'Write',
  'Plan',
  'Refactor',
  'Test',
  'Deploy',
  'Investigate',
  'Draft',
  'Schedule',
  'Email',
  'Call',
  'Order',
  'Clean',
  'Organize',
  'Migrate',
  'Design',
  'Prototype',
  'Document',
  'Audit',
  'Renew',
  'Book',
  'Prepare',
  'Ship',
  'Merge',
  'Archive',
  'Configure',
  'Optimize',
  'Follow up on',
  'Estimate',
  'Triage',
];
const NOUNS = [
  'the dashboard',
  'the API',
  'the invoice',
  'the monthly report',
  'the widget',
  'module 7',
  'the pipeline',
  'the backlog',
  'the vendor list',
  'the contract',
  'the schema',
  'the cache layer',
  'the landing page',
  'the onboarding flow',
  'the newsletter',
  'the migration',
  'the roadmap',
  'the retro notes',
  'the demo',
  'the release notes',
  'the staging env',
  'the runbook',
  'the sprint board',
  'the changelog',
  'the budget sheet',
  'the survey',
  'the wireframe',
  'the test suite',
  'the config',
  'the metrics',
  'the ticket queue',
  'the archive',
];
const PROJECT_THEMES = [
  'Platform',
  'Growth',
  'Infra',
  'Home Ops',
  'Side Project',
  'Finance',
  'Fitness',
  'Garage',
  'Volunteer',
  'Travel',
  'Reading',
  'Research',
  'Marketing',
  'Support',
  'Design System',
  'Data',
  'Mobile',
  'Web',
  'Ops',
  'Admin',
];
const GLYPHS = ['#', 'λ', '◈', '⊞', '❯', '⚙', '§', '✦', '¶', '☰', '★', '◆', '●', '▲'];
const COLORS = [
  '#ff9f43',
  '#46d369',
  '#b6c948',
  '#3fd7d7',
  '#5b8cff',
  '#ff6fae',
  '#c78bff',
  '#ffb000',
  '#888888',
  '#e05252',
];
const LABEL_WORDS = [
  'urgent',
  'quick',
  'waiting',
  'blocked',
  'review',
  'idea',
  'bug',
  'chore',
  'errand',
  'deep-work',
  'followup',
  'someday',
  'reading',
  'research',
  'admin',
  'finance',
  'home',
  'work',
  'health',
  'low-energy',
  'high-focus',
  'meeting',
  'call',
  'email',
  'writing',
];
const RECURS = [
  'every 3 days',
  'weekly on mon,wed,fri',
  'weekly on sun',
  'monthly on day 1',
  'every 2 weeks',
  'weekly on mon',
  'monthly on last fri',
];
const NOTE_TOPICS = [
  'Meeting notes',
  'Idea',
  'Reference',
  'Retro',
  'Checklist',
  'Spec',
  'Research',
  'Journal',
  'Summary',
  'Plan',
];
const FIB = [0, 1, 2, 3, 5, 8, 13];

const taskTitle = () => `${pick(VERBS)} ${pick(NOUNS)}`;
const noteBody = () => {
  const lines = [`# ${pick(NOTE_TOPICS)}: ${pick(NOUNS)}`, ''];
  for (let i = 0; i < rint(2, 6); i++) lines.push(`- ${pick(VERBS)} ${pick(NOUNS)}`);
  if (chance(0.3)) lines.push('', `See also [[${pick(NOUNS)}]].`);
  return lines.join('\n');
};

async function main() {
  const user = await createUser(db, {
    username: 'dev',
    email: 'dev@local.test',
    password: 'Password123!',
  });
  const owner = user.id;
  await db
    .updateTable('users')
    .set({ fib_sizing: 1, theme: 'plasma' })
    .where('id', '=', owner)
    .execute();
  const inbox = (await db
    .selectFrom('projects')
    .select('id')
    .where('owner_id', '=', owner)
    .where('name', '=', 'Inbox')
    .executeTakeFirst())!.id;

  // ---- labels (~68): a realistic named set + filler, a few pinned ----
  const labelIds: string[] = [];
  const labelNames = [...LABEL_WORDS];
  for (let i = labelNames.length; i < Math.round(68 * SCALE); i++)
    labelNames.push(`topic-${String(i).padStart(2, '0')}`);
  for (let i = 0; i < labelNames.length; i++)
    labelIds.push((await createLabel(db, owner, { name: labelNames[i], pinned: i < 3 })).id);

  // ---- projects (~37): a two-level tree ----
  const projectIds: string[] = [inbox];
  const roots: string[] = [];
  const nProjects = Math.round(35 * SCALE); // + inbox + the dedicated big project below = ~37
  for (let i = 0; i < nProjects; i++) {
    const asChild = i > 6 && chance(0.4) && roots.length;
    const p = await createProject(db, owner, {
      name: `${pick(PROJECT_THEMES)} ${String(i + 1).padStart(2, '0')}`,
      color: pick(COLORS),
      glyph: pick(GLYPHS),
      parentId: asChild ? pick(roots) : null,
      collapsed: chance(0.15),
    });
    projectIds.push(p.id);
    if (!asChild) roots.push(p.id);
  }

  // ---- tasks (~1025: 250 open + 775 done) with nesting, recurrence, labels, dates ----
  const t = (over: Parameters<typeof createTask>[2]) => createTask(db, owner, over);
  const rootTaskByProject = new Map<string, string[]>(); // for attaching subtasks

  // A dedicated BIG active project (like a real app backlog, e.g. tdx in prod): exactly ~30 OPEN
  // items plus a few done, so the heavy single-project view gets exercised. Kept out of the random
  // pool below so its open count stays put. Carved out of the totals so the seed stays prod-sized.
  const BIG_OPEN = 30;
  const BIG_DONE = 8;
  const bigProj = await createProject(db, owner, {
    name: 'Platform Rebuild',
    color: '#5b8cff',
    glyph: '◈',
  });
  {
    let n = 0;
    let parents = 0;
    while (n < BIG_OPEN) {
      const parent = await t({
        projectId: bigProj.id,
        title: taskTitle(),
        done: false,
        due: chance(0.6) ? d(rint(-5, 45)) : null,
        priority: pick([1, 2, 3, 3, 4, 5]),
        size: pick(FIB),
        labels: chance(0.6) ? sample(labelIds, rint(1, 2)) : [],
      });
      n++;
      if (parents < 6 && chance(0.5)) {
        parents++;
        for (let k = 0; k < rint(1, 3) && n < BIG_OPEN; k++) {
          await t({
            projectId: bigProj.id,
            parentId: parent.id,
            title: taskTitle(),
            done: false,
            labels: chance(0.4) ? sample(labelIds, 1) : [],
          });
          n++;
        }
      }
    }
    for (let i = 0; i < BIG_DONE; i++)
      await t({ projectId: bigProj.id, title: taskTitle(), done: true });
  }

  const nOpen = Math.round(250 * SCALE) - BIG_OPEN;
  const nDone = Math.round(775 * SCALE) - BIG_DONE;
  const doneIds: string[] = [];
  let made = 0;
  const total = nOpen + nDone;
  for (let i = 0; i < total; i++) {
    const done = i >= nOpen; // first block open, rest done
    const projectId = pick(projectIds);
    const siblings = rootTaskByProject.get(projectId) || [];
    // ~12% become a subtask of an existing root in the same project, ~3% a grandchild
    let parentId: string | null = null;
    if (siblings.length && chance(0.12)) parentId = pick(siblings);
    const over: Parameters<typeof createTask>[2] = {
      projectId,
      parentId,
      title: taskTitle(),
      done,
      due: chance(0.7) ? d(rint(-30, 60)) : null,
      priority: pick([1, 2, 2, 3, 3, 3, 4, 5]),
      size: pick(FIB),
      labels: chance(0.6) ? sample(labelIds, rint(1, 3)) : [],
      recurrence: !done && chance(0.25) ? pick(RECURS) : null,
      notes: chance(0.2)
        ? `${pick(VERBS)} ${pick(NOUNS)}; ${pick(VERBS).toLowerCase()} ${pick(NOUNS)}`
        : undefined,
      reminder: chance(0.1) ? `${d(rint(0, 14))}T${String(rint(6, 18)).padStart(2, '0')}:00` : null,
    };
    const task = await t(over);
    if (done) doneIds.push(task.id);
    if (!parentId) {
      siblings.push(task.id);
      rootTaskByProject.set(projectId, siblings);
    }
    if (++made % 250 === 0) console.log(`  …${made}/${total} tasks`);
  }

  // spread done tasks' completed_at over ~180 days so it looks like real history (not all "today")
  sqlite
    .prepare(
      `UPDATE tasks SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||(abs(random())%180)||' days'),
       updated_at = completed_at WHERE done=1 AND owner_id=?`,
    )
    .run(owner);

  // ---- folders (~11) + notes (~124) ----
  const folderIds: string[] = [];
  for (let i = 0; i < Math.round(11 * SCALE); i++) {
    folderIds.push(
      (
        await createFolder(db, owner, {
          name: `${pick(PROJECT_THEMES)} ${i + 1}`,
          color: pick(COLORS),
          glyph: pick(GLYPHS),
        })
      ).id,
    );
  }
  const nNotes = Math.round(124 * SCALE);
  for (let i = 0; i < nNotes; i++) {
    await createNote(db, owner, {
      title: `${pick(NOTE_TOPICS)} ${String(i + 1).padStart(3, '0')}`,
      body: noteBody(),
      folderId: chance(0.85) ? pick(folderIds) : null,
      reviewAt: chance(0.25) ? d(rint(-10, 30)) : null,
      labels: chance(0.4) ? sample(labelIds, rint(1, 2)) : [],
    });
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${nNotes} notes`);
  }

  // ---- calendars (~3) + a handful of events ----
  const cals: string[] = [];
  for (const name of ['Work', 'Home', 'Personal'])
    cals.push(
      (await createCalendar(db, owner, { name, color: pick(COLORS), glyph: pick(GLYPHS) })).id,
    );
  const e = (over: Parameters<typeof createEvent>[2]) => createEvent(db, owner, over);
  for (let i = 0; i < 10; i++) {
    const allDay = chance(0.3);
    await e({
      calendarId: pick(cals),
      title: `${pick(VERBS)} ${pick(NOUNS)}`,
      startAt: allDay
        ? d(rint(-3, 20))
        : `${d(rint(-3, 20))}T${String(rint(8, 17)).padStart(2, '0')}:00`,
      allDay,
      recurrence: chance(0.3) ? pick(RECURS) : null,
      labels: chance(0.4) ? sample(labelIds, 1) : [],
    });
  }

  // ---- a few pinned saved views (exercise the sidebar/topbar badge fan-out) ----
  await createSavedQuery(db, owner, {
    name: 'Deep work',
    query: 'label:deep-work status:open',
    glyph: '★',
    pinned: true,
  });
  await createSavedQuery(db, owner, {
    name: 'Waiting',
    query: 'label:waiting status:open',
    glyph: '◔',
    pinned: true,
  });
  await createSavedQuery(db, owner, {
    name: 'High priority',
    query: 'priority:5 status:open',
    glyph: '!',
    pinned: true,
  });
  await createSavedQuery(db, owner, {
    name: 'This month done',
    query: 'status:done',
    glyph: '✓',
    pinned: false,
  });

  const count = (q: string) => (sqlite.prepare(q).get() as { c: number }).c;
  console.log('\nheavy seed complete (dev / Password123!, theme plasma):');
  console.log(`  scale       : ${SCALE}x`);
  console.log(
    `  tasks       : ${count('SELECT count(*) c FROM tasks')} (open ${count('SELECT count(*) c FROM tasks WHERE done=0')}, done ${count('SELECT count(*) c FROM tasks WHERE done=1')})`,
  );
  console.log(`  projects    : ${count('SELECT count(*) c FROM projects')}`);
  console.log(`  labels      : ${count('SELECT count(*) c FROM labels')}`);
  console.log(`  notes       : ${count('SELECT count(*) c FROM notes')}`);
  console.log(`  folders     : ${count('SELECT count(*) c FROM folders')}`);
  console.log(`  events      : ${count('SELECT count(*) c FROM events')}`);

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
