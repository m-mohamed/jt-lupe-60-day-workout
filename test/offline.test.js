// Offline behaviour, run against the WORKER origin on purpose.
//
// This suite exists because every other offline check ran against the plain static
// server, where it passed — while the Cloudflare copy, the one actually used, failed
// to load at all with the network off. The Workers asset server redirects
// /index.html to /, so the cached entry carried `redirected: true`, and Chrome
// refuses a redirected response for a navigation. Same file, same code, different
// origin, opposite result. Test the origin people use.
//
// Needs `wrangler dev --port 8777` with the dev-auth flags from README.md.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8777/';

(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));

  await p.goto(url);
  const me = await p.evaluate(() => fetch('./api/me?ns=gym').then(r => r.json()).catch(() => null));
  if (!me || !me.email) {
    console.error('Not signed in to the dev worker — this suite would test nothing. Got:', JSON.stringify(me));
    await b.close(); process.exit(2);
  }
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const sw = await p.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: Boolean(navigator.serviceWorker.controller),
    caches: await caches.keys()
  }));
  t('service worker registered and controlling', sw.registrations > 0 && sw.controlled, JSON.stringify(sw));

  // Nothing in the cache may be a redirect: the browser will not accept one for a
  // navigation, which is precisely how the offline load broke.
  const cached = await p.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]);
    const requests = await cache.keys();
    return Promise.all(requests.map(async request => {
      const response = await cache.match(request);
      return { path: new URL(request.url).pathname, redirected: response.redirected, status: response.status };
    }));
  });
  t('the app shell is cached', cached.length >= 4, JSON.stringify(cached.map(r => r.path)));
  t('no cached entry is a redirect', cached.every(r => !r.redirected && r.status === 200),
    JSON.stringify(cached.filter(r => r.redirected)));

  // The real thing: pull the plug and reload, the way a gym basement does it.
  await ctx.setOffline(true);
  let reloaded = 'no error';
  await p.reload({ waitUntil: 'load', timeout: 25000 }).catch(e => { reloaded = String(e).split('\n')[0]; });
  await p.waitForTimeout(2000);
  const offline = await p.evaluate(() => ({
    url: location.href,
    title: document.getElementById('sessionTitle') ? document.getElementById('sessionTitle').textContent : null,
    inputs: document.querySelectorAll('.in-load').length,
    chip: document.getElementById('syncChip') ? document.getElementById('syncChip').dataset.state : null
  })).catch(e => ({ error: String(e).slice(0, 120) }));
  t('reloads with the network off', offline.inputs > 0 && Boolean(offline.title),
    JSON.stringify({ reloaded, ...offline }));

  // And it must still be a working log, not just a page that rendered.
  const wrote = await p.evaluate(async () => {
    const id = document.querySelectorAll('.in-load')[0].dataset.ex;
    writeSet(state.profile, state.date, id, 1, { load: '424', unit: 'lb', reps: 7, seconds: null, rir: 2 });
    await new Promise(s => setTimeout(s, 300));
    return { stored: setsFor(state.profile, state.date, id).map(s => s.load), dirty: readDirty().length };
  }).catch(e => ({ stored: [], dirty: 0, error: String(e).slice(0, 120) }));
  t('a set logged offline is stored and queued', wrote.stored.includes('424') && wrote.dirty > 0, JSON.stringify(wrote));

  await ctx.setOffline(false);
  await p.evaluate(() => { window.dispatchEvent(new Event('online')); scheduleSync(); });
  await p.waitForFunction(() => readDirty().length === 0, null, { timeout: 30000 }).catch(() => {});
  const back = await p.evaluate(() => ({ dirty: readDirty().length, chip: document.getElementById('syncChip').dataset.state, enabled: syncState.enabled, mode: syncState.mode }));
  t('the queue drains once the network is back', back.dirty === 0, JSON.stringify(back));
  // A page that booted with no signal used to stay local for its whole life. It has to
  // find its account again on its own.
  t('a page that booted offline reconnects without a reload', back.enabled && back.mode === 'signed-in', JSON.stringify(back));

  t('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
