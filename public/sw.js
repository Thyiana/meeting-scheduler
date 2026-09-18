// Bump this on any static-asset change so clients pick up the new files
// instead of serving a stale cached shell indefinitely.
const CACHE_NAME = 'meeting-scheduler-v2';
const ASSETS_TO_CACHE = [
  '/guest.html',
  '/index.html',
  '/signage.html',
  '/style.css',
  '/guest.css',
  '/app.js',
  '/guest.js',
  '/signage.js',
  '/i18n.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// GET /api/meetings and /api/rooms are the two calls the guest page needs
// to render *something* while offline. Every other /api/* call (POST/PUT/
// DELETE, or GET /api/admin/*) is left to fail naturally — there is nothing
// useful to serve from cache for those, and the frontend already handles
// the resulting network error by showing the "offline" badge/toast.
const OFFLINE_SNAPSHOT_PATHS = ['/api/meetings', '/api/rooms'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  if (OFFLINE_SNAPSHOT_PATHS.includes(url.pathname)) {
    // Network-first: always prefer live data when online, but stash every
    // successful response so the most recent snapshot survives offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return; // let other API calls fail naturally offline

  // Static assets: cache-first, falling back to network, so the app shell
  // itself still loads with zero connectivity (cold start on dead Wi-Fi).
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }))
  );
});
