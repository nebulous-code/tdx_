/* sw.js — service worker: app-shell caching + Web Push handling.
   Served from the root (/sw.js) so its scope covers the whole app. */

const CACHE = 'tdx-shell-v1';

// The static app shell. Everything here is same-origin (Vue is vendored), so
// the cache is fully inspectable and works offline.
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/js/vue.global.prod.js',
  '/js/recurrence.js',
  '/js/query.js',
  '/js/data.js',
  '/js/sidebar.js',
  '/js/tasklist.js',
  '/js/recurrence-builder.js',
  '/js/task-detail.js',
  '/js/query-bar.js',
  '/js/command-palette.js',
  '/js/modals.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the shell; never cache the API (always go to network).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network-only

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // opportunistically cache successful same-origin GETs
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('/index.html')); // offline navigation fallback
    })
  );
});

// ---- Web Push ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'tdx_ reminder';
  const options = {
    body: data.body || '',
    tag: data.tag || 'tdx',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
