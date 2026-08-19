// A phone that already has an older version installed must heal itself the next time
// it is opened with a connection — no reinstall, no clearing site data, no being told
// to do anything. This suite poisons the cache the way the old worker left it and
// checks the app takes over.
//
// Needs `wrangler dev --port 8777` with the dev-auth flags from README.md.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8777/';
const OLD_CACHE = 'jt-lupe-workout-v5';

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

  // Put the device back in the state the previous release left it in: everything
  // wiped, and an old cache holding a redirected shell — the exact entry the browser
  // refuses to serve for a navigation.
  const poisoned = await p.evaluate(async name => {
    await Promise.all((await caches.keys()).map(key => caches.delete(key)));
    const cache = await caches.open(name);
    await cache.put('./index.html', await fetch('./index.html'));   // the asset server redirects this to '/'
    const stored = await cache.match('./index.html');
    return { redirected: stored ? stored.redirected : null };
  }, OLD_CACHE);
  t('the old cache really did hold a redirected shell', poisoned.redirected === true, JSON.stringify(poisoned));

  // Also log something first, because an upgrade must never cost anyone their data.
  const before = await p.evaluate(() => {
    const id = document.querySelectorAll('.in-load')[0].dataset.ex;
    writeSet(state.profile, state.date, id, 1, { load: '313', unit: 'lb', reps: 6, seconds: null, rir: 2 });
    return { id, date: state.date, profile: state.profile, records: Object.keys(localStorage).filter(k => k.startsWith('jt-lupe')).length };
  });

  // Ship a new version at it. Registering a different script URL for the same scope is
  // what a deploy does to an installed phone: install runs, then activate, which is
  // where old caches are pruned. Reloading would not do it — the same worker is
  // already active, and activate only fires once per version.
  await p.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('./service-worker.js?deploy=1');
    const worker = registration.installing || registration.waiting;
    if (worker) await new Promise(done => worker.addEventListener('statechange', function check() {
      if (worker.state === 'activated') { worker.removeEventListener('statechange', check); done(); }
    }));
  });

  // Then one ordinary online open — nothing else.
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(async () => !(await caches.keys()).includes('jt-lupe-workout-v5'), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const after = await p.evaluate(async () => ({
    caches: await caches.keys(),
    controlled: Boolean(navigator.serviceWorker.controller)
  }));
  t('the old cache is gone after one online open', !after.caches.includes(OLD_CACHE) && after.caches.length === 1,
    JSON.stringify(after));

  // The shell must be back even though install already ran before the wipe: the cache
  // is only filled at install, so without the navigation refreshing it a browser that
  // evicts storage — iOS does — would strand the app with no offline copy at all.
  const shell = await p.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]);
    const rows = await cache.keys();
    return Promise.all(rows.map(async request => {
      const response = await cache.match(request);
      return { path: new URL(request.url).pathname, redirected: response.redirected };
    }));
  });
  t('the shell is rebuilt after a wipe', shell.length > 0, JSON.stringify(shell.map(r => r.path)));
  t('no entry in the rebuilt shell is a redirect', shell.every(r => !r.redirected),
    JSON.stringify(shell.filter(r => r.redirected)));

  const kept = await p.evaluate(([id, date, profile]) => setsFor(profile, date, id).map(s => s.load), [before.id, before.date, before.profile]);
  t('the upgrade kept what was already logged', kept.includes('313'), JSON.stringify({ kept, before: before.records }));

  // The whole point: it now survives losing the network.
  await ctx.setOffline(true);
  let reloadError = 'none';
  await p.reload({ waitUntil: 'load', timeout: 25000 }).catch(e => { reloadError = String(e).split('\n')[0]; });
  await p.waitForTimeout(1500);
  const offline = await p.evaluate(() => ({
    title: document.getElementById('sessionTitle') ? document.getElementById('sessionTitle').textContent : null,
    inputs: document.querySelectorAll('.in-load').length
  })).catch(e => ({ error: String(e).slice(0, 120) }));
  t('an upgraded device loads offline', offline.inputs > 0 && Boolean(offline.title), JSON.stringify({ reloadError, ...offline }));

  await ctx.setOffline(false);
  t('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
