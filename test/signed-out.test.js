// What happens when the Cloudflare Access session runs out.
//
// This is the bug that actually reached them: Access does not answer an expired
// session with 401. It answers 302 to a login page on a different origin, which a
// normal fetch follows, fails CORS on, and rejects. The app read that as a network
// error, called itself offline, and retried for ever — no sign-in prompt, no sync,
// no clue. The 401 branch it had was dead code against the real thing.
//
// Needs `wrangler dev --port 8777` with the dev-auth flags from README.md.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8777/';
const LOGIN = 'https://team.cloudflareaccess.example/cdn-cgi/access/login/app';

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
  await p.evaluate(() => {
    state.date = '2026-08-28';
    localStorage.setItem('jt-lupe-active-date', state.date);
    renderSession();
  });

  // Expire the session: every API call now answers exactly the way Access does.
  const expire = () => p.route('**/api/**', route => route.fulfill({
    status: 302, headers: { location: LOGIN }, body: ''
  }));
  await expire();

  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => ['error', 'offline', 'local', 'synced'].includes(document.getElementById('syncChip').dataset.state),
    null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);

  const shown = await p.evaluate(() => ({
    state: document.getElementById('syncChip').dataset.state,
    text: document.getElementById('syncText').textContent,
    title: document.getElementById('syncChip').title,
    mode: syncState.mode,
    enabled: syncState.enabled
  }));
  t('an expired session is recognised as signed out', shown.mode === 'rejected', JSON.stringify(shown));
  t('the chip says to sign in, not offline', /sign in/i.test(shown.text), JSON.stringify(shown));
  t('the chip explains nothing is lost', /nothing logged here is lost/i.test(shown.title), shown.title);

  // It must still be a usable log while signed out — that is the whole point of
  // local-first. Losing a session mid-session cannot cost anyone their sets.
  const logged = await p.evaluate(async () => {
    const id = document.querySelectorAll('.in-load')[0].dataset.ex;
    writeSet(state.profile, state.date, id, 1, { load: '242', unit: 'lb', reps: 8, seconds: null, rir: 2 });
    await new Promise(s => setTimeout(s, 400));
    return { id, stored: setsFor(state.profile, state.date, id).map(s => s.load), dirty: readDirty().length };
  });
  t('sets still log while signed out', logged.stored.includes('242'), JSON.stringify(logged));
  t('and they queue for when the session comes back', logged.dirty > 0, String(logged.dirty));

  // Tapping the chip has to actually attempt a sign-in, which is a navigation.
  const navigated = p.waitForNavigation({ timeout: 10000 }).then(() => true).catch(() => false);
  await p.locator('#syncChip').tap();
  t('tapping the chip goes back for a sign-in', await navigated);

  // Sign back in: the queue must drain without anyone reinstalling anything.
  await p.unroute('**/api/**');
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => readDirty().length === 0, null, { timeout: 40000 }).catch(() => {});
  const recovered = await p.evaluate(([id]) => ({
    dirty: readDirty().length, mode: syncState.mode, enabled: syncState.enabled,
    stored: setsFor(state.profile, state.date, id).map(s => s.load)
  }), [logged.id]);
  t('signing back in drains what was logged while out', recovered.dirty === 0 && recovered.stored.includes('242'),
    JSON.stringify(recovered));
  t('and the app is signed in again', recovered.enabled && recovered.mode === 'signed-in', JSON.stringify(recovered));

  t('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
