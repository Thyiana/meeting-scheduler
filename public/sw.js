// Bumped this release specifically to force a one-time clean break from the
// previous cache (see the stale-cache bug note below) — every browser that
// had the old v2 cache stuck will treat this as a brand-new cache namespace
// and start fresh. Going forward, the fetch strategy below (stale-while-
// revalidate) means the cache name no longer NEEDS to be bumped on every
// deploy for updates to reach people — but bumping it is still a fine way
// to force an immediate full refresh if ever needed again.
const CACHE_NAME = 'meeting-scheduler-v4';
const ASSETS_TO_CACHE = [
  '/guest.html',
  '/index.html',
  '/signage.html',
  '/style.css',
  '/guest.css',
  '/signage.css',
  '/app.js',
  '/guest.js',
  '/signage.js',
  '/i18n.js',
  '/theme.js',
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

  // Static assets (HTML/CSS/JS): stale-while-revalidate, NOT pure
  // cache-first. This was the actual bug behind "I deployed but nothing
  // changed" — a pure cache-first strategy with a fixed cache name means
  // once a file is cached, the browser NEVER asks the network for it again,
  // no matter how many times the server-side code changes. Every visit now:
  //   1. Immediately serves whatever is in the cache (or waits for network
  //      if nothing is cached yet) — so it's still instant, and still works
  //      fully offline.
  //   2. Simultaneously fetches the live network copy in the background and
  //      overwrites the cache with it.
  // The very next reload after a deploy is what may still show the old
  // version (the network fetch from *this* visit is still in flight when
  // this visit renders) — but the reload after THAT one is guaranteed
  // fresh, self-healing on every deploy without ever needing a manual cache
  // name bump again.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then((res) => {
        // Only cache good responses. Without this check, a transient 502/503
        // (e.g. Render restarting) would overwrite the cached app.js with an
        // error page, and the next visit would serve that broken copy.
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || Response.error()); // offline and nothing cached yet: genuinely fails
      return cached || networkFetch;
    })
  );
});
