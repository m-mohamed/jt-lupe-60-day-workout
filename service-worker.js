// This worker caches app *files* only. All workout data lives in localStorage, which
// the Cache API never touches — clearing or renaming a cache cannot delete a log entry.
const CACHE_NAME = 'jt-lupe-workout-v9';
const CORE_ASSETS = ['./', './index.html', './beautiful-ui.css', './manifest.webmanifest', './icon.svg'];

/**
 * Store a response the browser will accept for a navigation.
 *
 * The Workers asset server redirects `/index.html` to `/`, so `cache.addAll` stored a
 * response with `redirected: true` — and Chrome refuses a redirected response for a
 * navigation, which is the same rule the online branch below already works around.
 * Offline, the fallback handed back exactly that entry and the tab died with
 * ERR_FAILED instead of loading the app. Rebuilding the response drops the flag.
 */
async function cacheClean(cache, request) {
  // `redirect: 'manual'` matters twice over. It stops the asset server's
  // /index.html → / redirect from being stored, and it stops an expired Access
  // session from taking the whole install down: that login redirect points at
  // another origin, a following fetch fails CORS and rejects, and one rejection
  // used to mean the new version never installed at all — so the app could not
  // update itself precisely when someone needed to sign back in.
  const response = await fetch(request, { credentials: 'same-origin', redirect: 'manual' });
  if (!response.ok || response.type !== 'basic') return false;
  const body = await response.blob();
  await cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  }));
  return true;
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    // Best effort, one asset at a time failing on its own. Install must succeed even
    // if nothing could be cached; the navigation handler refills the shell later.
    await Promise.all(CORE_ASSETS.map(asset => cacheClean(cache, asset).catch(() => false)));
  }));
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
        .then(response => {
          // Refresh the offline shell on every successful navigation. The cache is
          // only filled at install, so a browser evicting it - iOS does this under
          // storage pressure - used to leave the app permanently unable to open
          // offline, with no way back short of a reinstall.
          if (response.ok && response.type === 'basic' && !response.redirected) {
            const copy = response.clone();
            event.waitUntil(copy.blob().then(body => caches.open(CACHE_NAME).then(cache => cache.put('./', new Response(body, {
              status: copy.status, statusText: copy.statusText, headers: copy.headers
            })))));
          }
          return response.redirected ? Response.redirect(response.url, 303) : response;
        })
        .catch(async () => {
          // './' first: on the Workers origin it is the URL that serves the app
          // directly, while './index.html' is a redirect to it.
          const hit = (await caches.match('./')) || (await caches.match('./index.html'));
          if (!hit) return Response.error();
          // Belt and braces for a response cached by an older version of this worker,
          // which the browser would reject for a navigation.
          return hit.redirected
            ? new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers: hit.headers })
            : hit;
        })
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
