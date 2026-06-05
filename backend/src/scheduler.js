// scheduler.js — fires reminder notifications.
//
// Every minute: find tasks whose reminder time has arrived and that we haven't
// already notified for, push a notification, and record that we sent it.
//
// Timezone: reminders are stored as naive local timestamps ('YYYY-MM-DDTHH:MM',
// exactly what the browser's <input type="datetime-local"> produces). We compare
// against the server's LOCAL wall-clock formatted the same way, so set the
// container's TZ env to your local timezone (see compose.yaml).

const db = require('./db');
const push = require('./push');

const TICK_MS = 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local wall-clock as 'YYYY-MM-DDTHH:MM' (matches stored reminder format).
function localNow() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) +
    ':' + pad(d.getMinutes())
  );
}

const dueStmt = db.prepare(
  `SELECT id, title, reminder
   FROM tasks
   WHERE reminder IS NOT NULL
     AND done = 0
     AND reminder <= ?
     AND NOT EXISTS (
       SELECT 1 FROM reminders_sent rs
       WHERE rs.task_id = tasks.id AND rs.reminder_at = tasks.reminder
     )`
);
const markSent = db.prepare(
  'INSERT OR IGNORE INTO reminders_sent (task_id, reminder_at, sent_at) VALUES (?, ?, ?)'
);
const cleanupOrphans = db.prepare(
  'DELETE FROM reminders_sent WHERE task_id NOT IN (SELECT id FROM tasks)'
);

async function tick() {
  // Without VAPID keys we can't deliver, so don't mark anything sent — that way
  // reminders still fire once keys are configured.
  if (!push.isConfigured()) return;

  try {
    cleanupOrphans.run();
    const due = dueStmt.all(localNow());
    for (const task of due) {
      const { sent } = await push.sendToAll({
        title: '◷ ' + task.title,
        body: 'Reminder',
        tag: 'tdx-' + task.id,
        url: '/',
      });
      // Record it even if there are zero subscriptions, so we don't spam later
      // when a device subscribes; the reminder already "fired" at this time.
      markSent.run(task.id, task.reminder, new Date().toISOString());
      if (sent > 0) console.log(`[scheduler] reminded "${task.title}" -> ${sent} device(s)`);
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err.message);
  }
}

function start() {
  setInterval(tick, TICK_MS);
  console.log('[scheduler] started (60s tick)');
}

module.exports = { start, tick };
