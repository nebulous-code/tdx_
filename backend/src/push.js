// push.js — thin wrapper around the `web-push` library.
//
// Configures VAPID from env and exposes:
//   isConfigured()        -> whether VAPID keys are present
//   publicKey()           -> the VAPID public key (handed to the browser)
//   saveSubscription(sub) -> upsert a browser push subscription
//   sendToAll(payload)    -> push to every subscription; prune dead ones

const webpush = require('web-push');
const db = require('./db');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

const configured = !!(PUBLIC_KEY && PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn('[push] VAPID keys not set — notifications disabled. Run `npm run gen-vapid`.');
}

function isConfigured() {
  return configured;
}

function publicKey() {
  return PUBLIC_KEY;
}

function saveSubscription(sub) {
  if (!sub || !sub.endpoint || !sub.keys) throw new Error('invalid subscription');
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, keys_json, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json`
  ).run(sub.endpoint, JSON.stringify(sub.keys), new Date().toISOString());
}

// Send a payload (object) to every stored subscription. Subscriptions that the
// push service reports as gone (404/410) are deleted.
async function sendToAll(payload) {
  if (!configured) return { sent: 0, removed: 0 };
  const subs = db.prepare('SELECT endpoint, keys_json FROM push_subscriptions').all();
  const del = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (row) => {
      const subscription = { endpoint: row.endpoint, keys: JSON.parse(row.keys_json) };
      try {
        await webpush.sendNotification(subscription, body);
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          del.run(row.endpoint);
          removed += 1;
        } else {
          console.error('[push] send failed:', err.statusCode || err.message);
        }
      }
    })
  );

  return { sent, removed };
}

module.exports = { isConfigured, publicKey, saveSubscription, sendToAll };
