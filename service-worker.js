// This worker caches app *files* only. All workout data lives in localStorage, which
// the Cache API never touches — clearing or renaming a cache cannot delete a log entry.
const CACHE_NAME = 'jt-lupe-workout-v5';
const CORE_ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cloudflare Access runs its login handshake on this same origin under /cdn-cgi/.
  // A service worker must never sit in the middle of that exchange: intercepting the
  // callback breaks the cookie/redirect handshake and the user lands on
  // "Invalid login session".
  if (url.pathname.startsWith('/cdn-cgi/')) return;

  // Sync and identity must always hit the network. A cached /api/me would strand the
  // app in a stale signed-in state, and a cached sync reply would replay old data.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations need care. When an Access session expires the origin answers with a
  // redirect to the login page, and a worker may not return a *redirected* response
  // to a navigation — the browser rejects it and the tab errors instead of signing
  // you back in. Hand the browser the redirect itself and let it follow natively.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => (response.redirected ? Response.redirect(response.url, 303) : response))
        .catch(async () => (await caches.match('./index.html')) || Response.error())
    );
    return;
  }

  // Everything else: network-first so a fresh deploy is picked up on the next online
  // load, with the cache as the fallback for offline gym wifi.
  event.respondWith(
    fetch(request)
      .then(response => {
        // Never cache an error page, or a redirect, over a known-good asset.
        if (response.ok && response.type === 'basic' && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(response => response || caches.match('./index.html')))
  );
});
