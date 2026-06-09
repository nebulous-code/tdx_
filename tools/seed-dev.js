#!/usr/bin/env node
// seed-dev.js — (re)build data/seed.db: a sample database with one dev user and a
// realistic set of projects/tasks/labels, with due dates relative to *today* so it
// always looks fresh. tools/dev.sh --refresh runs this and copies it over data/tdx.db.
//
//   Login:  username  dev     password  DevPass!23
//
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');                 // repo root (this file lives in tools/)
const SEED = path.resolve(ROOT, 'data/seed.db');
for (const ext of ['', '-wal', '-shm']) { try { fs.rmSync(SEED + ext); } catch (_) {} }
process.env.DB_PATH = SEED;                 // db.js reads this at require time

const db = require('../backend/src/db');    // opens SEED, runs migrations, exports handle + seedUserDefaults
const auth = require('../backend/src/auth');

const USER = 'u_dev000001';
const today = new Date();
const D = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }; // YYYY-MM-DD + n days
const now = today.toISOString();

(async () => {
  const passwordHash = await auth.hashPassword('DevPass!23');

  const build = db.transaction(() => {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, state_version, is_admin, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, 1, ?, ?)`).run(USER, 'dev', 'dev@local.test', passwordHash, now, now);
    db.seedUserDefaults(USER);   // p_inbox + the 5 system smart-views

    // ---- labels ----
    const L = db.prepare('INSERT INTO labels (user_id, id, name) VALUES (?, ?, ?)');
    [['l_urgent','urgent'],['l_quick','quick'],['l_errand','errand'],['l_bug','bug'],['l_idea','idea']]
      .forEach(([id, name]) => L.run(USER, id, name));

    // ---- projects (p_inbox already seeded at position 0) ----
    const P = db.prepare('INSERT INTO projects (user_id, id, parent_id, name, color, glyph, collapsed, position) VALUES (?, ?, ?, ?, ?, ?, 0, ?)');
    P.run(USER, 'p_home',    null,     'Home',             '#ff9f43', '☰', 1);
    P.run(USER, 'p_garden',  'p_home', 'Garden',           '#46d369', '✦', 2);
    P.run(USER, 'p_finance', 'p_home', 'Finances',         '#b6c948', '§', 3);
    P.run(USER, 'p_work',    null,     'Work',             '#5b8cff', '▲', 4);
    P.run(USER, 'p_website', 'p_work', 'Website Redesign', '#3fd7d7', '◈', 5);
    P.run(USER, 'p_reading', null,     'Reading List',     '#ffb000', '¶', 6);

    // ---- tasks ---- column order matches state.js
    const T = db.prepare(`INSERT INTO tasks
      (user_id, id, project_id, parent_id, title, done, due, reminder, recurrence, notes, priority, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const TL = db.prepare('INSERT OR IGNORE INTO task_labels (user_id, task_id, label_id) VALUES (?, ?, ?)');
    let n = 0;
    const task = (o) => {
      const id = o.id || ('t_' + (++n));
      T.run(USER, id, o.project || 'p_inbox', o.parent || null, o.title, o.done ? 1 : 0,
            o.due || null, o.reminder || null, o.rec || null, o.notes || '', o.priority || 0,
            now, o.done ? now : null);
      (o.labels || []).forEach((l) => TL.run(USER, id, l));
      return id;
    };

    task({ project:'p_inbox',   title:'Buy groceries', due:D(0), priority:2, labels:['l_errand','l_quick'] });
    task({ project:'p_inbox',   title:'Call dentist for an appointment', due:D(1), labels:['l_errand'] });

    task({ project:'p_home',    title:'Fix the leaky kitchen faucet', due:D(-2), priority:4, labels:['l_urgent'], notes:'Need a new washer — measure the size first.' });
    task({ project:'p_home',    title:'Plan the weekend hike', due:D(4), priority:1 });

    task({ project:'p_garden',  title:'Water the tomatoes', due:D(0), rec:'every 2 days' });
    task({ project:'p_garden',  title:'Buy mulch and compost', due:D(1), priority:2 });
    task({ project:'p_garden',  title:'Prune the roses', done:true, priority:1 });

    task({ project:'p_finance', title:'Pay the credit card bill', due:D(5), priority:5, labels:['l_urgent'], reminder:D(5)+'T09:00' });
    task({ project:'p_finance', title:'Review the monthly budget', rec:'every month on day 1', priority:2 });
    task({ project:'p_finance', title:'Cancel unused subscriptions', priority:3, labels:['l_idea'] });

    const q3 = task({ project:'p_work', title:'Prepare the Q3 status report', due:D(3), priority:4, notes:'Pull the metrics from the dashboard.' });
    task({ parent:q3, project:'p_work', title:'Gather the sales numbers', done:true });
    task({ parent:q3, project:'p_work', title:'Draft the summary slide' });
    task({ parent:q3, project:'p_work', title:'Send to manager for review' });
    task({ project:'p_work',    title:'1:1 with manager', due:D(2), rec:'every week on tue' });

    task({ project:'p_website', title:'Fix the mobile nav overflow', due:D(0), priority:5, labels:['l_bug','l_urgent'], notes:'Header runs off the right edge in portrait.' });
    task({ project:'p_website', title:'Update the homepage hero copy', due:D(6), priority:3 });
    task({ project:'p_website', title:'Deploy the redesign to staging', done:true, priority:3 });

    task({ project:'p_reading', title:"Finish 'The Pragmatic Programmer'", priority:1, labels:['l_idea'] });
    task({ project:'p_reading', title:"Start 'Designing Data-Intensive Applications'" });
  });
  build();

  // sanity: the password we set really verifies
  const ok = await auth.verifyPassword(
    db.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(USER).h, 'DevPass!23');
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM projects WHERE user_id=?) p,
      (SELECT COUNT(*) FROM tasks    WHERE user_id=?) t,
      (SELECT COUNT(*) FROM labels   WHERE user_id=?) l`).get(USER, USER, USER);
  console.log(`✓ data/seed.db built — user "dev" / DevPass!23 (password verifies: ${ok})`);
  console.log(`  ${counts.p} projects · ${counts.t} tasks · ${counts.l} labels`);
  db.pragma('wal_checkpoint(TRUNCATE)');   // flush WAL into seed.db so a plain copy is a complete db
  db.close();
  process.exit(0);
})().catch((e) => { console.error('✗ seed failed:', e); process.exit(1); });
