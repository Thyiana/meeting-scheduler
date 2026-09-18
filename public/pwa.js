// Registered from every page (admin/guest/signage) so all three get the
// offline app-shell + last-known-schedule caching described in sw.js.
// Wrapped defensively: some browsers (older WeChat webviews in particular)
// don't support Service Worker at all, and that must never block the page.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed (non-fatal):', err);
    });
  });
}
