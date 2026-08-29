// A whole challenge's worth of data, pushed through the real client against the real
// sync API, then the things that only break at volume: batching, cursor bookkeeping,
// a flapping connection, a second device, and the Worker's own limits.
//
// Needs `wrangler dev --port 8777` with the dev-auth flags from README.md.
const { chromium } = require('playwright-core');
const { launchOptions, SELECT_ALL } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const settle = p => p.waitForFunction(
  () => ['synced', 'local', 'offline', 'error'].includes(document.getElementById('syncChip').dataset.state),
  null, { timeout: 60000 });
const url = 'http://127.0.0.1:8777/';

(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));
  await p.goto(url); await settle(p);

  const me = await p.evaluate(() => fetch('./api/me?ns=gym').then(r => r.json()).catch(() => null));
  if (!me || !me.email) {
    console.error('Not signed in to the dev worker — this suite would test nothing. Got:', JSON.stringify(me));
    console.error('Start it with: npx wrangler@4 dev --port 8777 --var ACCESS_TEAM_DOMAIN: --var ACCESS_AUD: --var DEV_EMAIL:stress@local');
    await b.close(); process.exit(2);
  }

  // Start from a known-empty account so counts mean something.
  await p.evaluate(() => localStorage.clear());
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

  /* ---------- write a full 60-day challenge for both people ---------- */
  const seeded = await p.evaluate(() => {
    const start = new Date(2026, 7, 17);
    let sets = 0, meals = 0, habits = 0, weights = 0;
    for (let offset = 0; offset < 60; offset += 1) {
      const d = new Date(start); d.setDate(start.getDate() + offset);
      if (d.getDay() === 0 || d.getDay() === 6) continue;      // weekdays only, like the plan
      const date = dateKey(d);
      const day = dayForDate(date);
      for (const profile of ['jt', 'lupe']) {
        day.exercises.forEach(ex => {
          const count = ex.sets || 3;
          for (let n = 1; n <= count; n += 1) {
            writeSet(profile, date, ex.id, n, {
              load: String(100 + offset), unit: 'lb',
              reps: ex.kind === 'timed' ? null : 10,
              seconds: ex.kind === 'timed' ? 45 : null, rir: 2
            });
            sets += 1;
          }
        });
        writeJSON(K.meal(profile, date, `m${offset}`), { name: 'Chicken and rice', protein: 45 }); meals += 1;
        writeJSON(K.bodyweight(profile, date), { value: 198 - offset * 0.1, unit: 'lb' }); weights += 1;
        ['protein', 'preworkout', 'sleep'].forEach(h => {
          writeJSON(K.habit(profile, date, h), { done: true }); habits += 1;
        });
        writeJSON(K.supplement(profile, date, `s${offset}`), {
          name: 'Creatine monohydrate', dose: 5, unit: 'g', at: new Date().toISOString()
        });
      }
    }
    return { sets, meals, habits, weights, dirty: readDirty().length, local: Object.keys(localStorage).filter(k => k.startsWith('jt-lupe')).length };
  });
  t('seeded a full challenge for both profiles', seeded.sets > 1000 && seeded.dirty > 1500,
    JSON.stringify(seeded));

  /* ---------- it must all reach the server, in batches, without wedging ---------- */
  const started = Date.now();
  await p.evaluate(() => scheduleSync());
  await p.waitForFunction(() => readDirty().length === 0, null, { timeout: 120000 }).catch(() => {});
  await settle(p);
  const elapsed = Date.now() - started;

  const server = await p.evaluate(() => fetch('./api/stats?ns=gym').then(r => r.json()));
  const dirtyLeft = await p.evaluate(() => readDirty().length);
  t('the whole backlog syncs, nothing left dirty', dirtyLeft === 0, `dirty=${dirtyLeft} after ${elapsed}ms`);
  t('every local record reached the server', server.records >= seeded.local - 5,
    JSON.stringify({ server: server.records, local: seeded.local, bytes: server.bytes }));
  t('sync of a full challenge finishes inside 60s', elapsed < 60000, `${elapsed}ms`);

  /* ---------- the tabs must still render at that volume ---------- */
  const render = await p.evaluate(async () => {
    const time = async fn => { const t0 = performance.now(); await fn(); return Math.round(performance.now() - t0); };
    const progress = await time(() => { setTab('progress'); renderProgress(); });
    const fuel = await time(() => { setTab('fuel'); renderFuel(); });
    const train = await time(() => { setTab('train'); renderSession(); });
    return { progress, fuel, train,
      strengthRows: document.querySelectorAll('#strengthBody tr').length,
      sessions: document.getElementById('statSessions').textContent,
      sets: document.getElementById('statLifts').textContent };
  });
  t('progress tab renders under 1s with 60 days logged', render.progress < 1000, JSON.stringify(render));
  // `seeded.sets` covers both profiles while Progress intentionally shows the active
  // profile only. A persistent local dev database can contain more, but a fresh CI
  // database should show exactly half of the seed rather than an obsolete 5-day-plan
  // threshold.
  t('progress counts the active profile’s whole challenge',
    Number(render.sets.replace(/\D/g, '')) >= Math.floor(seeded.sets / 2),
    JSON.stringify({ sessions: render.sessions, sets: render.sets, seeded: seeded.sets }));

  /* ---------- a second device must converge on the same data ---------- */
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await ctx2.newPage();
  const errors2 = []; p2.on('pageerror', e => errors2.push(String(e)));
  await p2.goto(url); await settle(p2);
  await p2.waitForFunction(() => Object.keys(localStorage).filter(k => k.startsWith('jt-lupe:')).length > 1500,
    null, { timeout: 90000 }).catch(() => {});
  const second = await p2.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('jt-lupe:')).length);
  t('a fresh device pulls the whole history', second > 1500, `${second} records`);

  /* ---------- last write wins across two devices ---------- */
  await p.evaluate(() => { writeSet('jt', '2026-08-19', 'leg-press', 1, { load: '111', unit: 'lb', reps: 5, seconds: null, rir: 2 }); scheduleSync(); });
  await p.waitForTimeout(2500);
  await p2.evaluate(() => { writeSet('jt', '2026-08-19', 'leg-press', 1, { load: '222', unit: 'lb', reps: 5, seconds: null, rir: 2 }); scheduleSync(); });
  await p2.waitForTimeout(3000);
  await p.evaluate(() => scheduleSync()); await p.waitForTimeout(3000);
  const converged = await p.evaluate(() => fetch('./api/export?ns=gym').then(r => r.json())
    .then(dump => JSON.parse(dump.data['jt-lupe:jt:set:2026-08-19:leg-press:1']).load));
  t('last write wins across two devices', converged === '222', String(converged));

  /* ---------- a flapping connection must not lose or duplicate ---------- */
  // Sequential on purpose: this is one connection flapping, not four connections.
  /* eslint-disable no-await-in-loop */
  for (let round = 0; round < 4; round += 1) {
    await ctx.setOffline(true);
    await p.evaluate(n => { window.dispatchEvent(new Event('offline'));
      writeSet('lupe', '2026-08-20', 'leg-press', n + 1, { load: `${300 + n}`, unit: 'lb', reps: 6, seconds: null, rir: 2 }); }, round);
    await p.waitForTimeout(400);
    await ctx.setOffline(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForTimeout(1500);
  }
  /* eslint-enable no-await-in-loop */
  await p.evaluate(() => scheduleSync());
  await p.waitForFunction(() => readDirty().length === 0, null, { timeout: 45000 }).catch(() => {});
  const flap = await p.evaluate(() => fetch('./api/export?ns=gym').then(r => r.json())
    .then(dump => Object.keys(dump.data).filter(k => k.startsWith('jt-lupe:lupe:set:2026-08-20:leg-press:')).length));
  t('four offline/online flaps land exactly four sets', flap === 4, String(flap));
  t('nothing left queued after the flapping', (await p.evaluate(() => readDirty().length)) === 0);

  /* ---------- the Worker's own limits ---------- */
  const limits = await p.evaluate(async () => {
    const post = body => fetch('./api/sync?ns=gym', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => ({ status: r.status, body: await r.json() }));
    return {
      tooMany: await post({ changes: Array.from({ length: 2001 }, (_, i) => ({ key: `k${i}`, value: 'x' })) }),
      hugeValue: await post({ changes: [{ key: 'big', value: 'x'.repeat(70000) }] }),
      multibyteValue: await post({ changes: [{ key: 'multibyte', value: 'é'.repeat(40000) }] }),
      longKey: await post({ changes: ['k'.repeat(300)].map(k => ({ key: k, value: 'x' })) }),
      noKey: await post({ changes: [{ value: 'x' }] }),
      notArray: await post({ changes: 'nope' }),
      oversizedBody: await post({ changes: [], padding: 'x'.repeat(2 * 1024 * 1024) }),
      badNs: await fetch('./api/sync?ns=../evil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"changes":[]}' }).then(r => r.status),
      badJson: await fetch('./api/sync?ns=gym', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' }).then(r => r.status)
    };
  });
  t('over-large batch rejected', limits.tooMany.status === 400 && /too many/.test(limits.tooMany.body.detail || ''), JSON.stringify(limits.tooMany.body));
  t('oversized value rejected', limits.hugeValue.status === 400, JSON.stringify(limits.hugeValue.body));
  t('value limit measures UTF-8 bytes', limits.multibyteValue.status === 400, JSON.stringify(limits.multibyteValue.body));
  t('over-long key rejected', limits.longKey.status === 400, JSON.stringify(limits.longKey.body));
  t('keyless change rejected', limits.noKey.status === 400, JSON.stringify(limits.noKey.body));
  t('non-array changes rejected', limits.notArray.status === 400, JSON.stringify(limits.notArray.body));
  t('oversized sync body rejected before parsing', limits.oversizedBody.status === 413 && limits.oversizedBody.body.error === 'payload_too_large',
    JSON.stringify(limits.oversizedBody));
  t('path-traversal namespace rejected', limits.badNs === 400, String(limits.badNs));
  t('malformed JSON rejected', limits.badJson === 400, String(limits.badJson));

  /* ---------- a rejected batch must not wedge the queue ---------- */
  const recovered = await p.evaluate(async () => {
    writeSet('jt', '2026-08-21', 'leg-press', 1, { load: '77', unit: 'lb', reps: 9, seconds: null, rir: 2 });
    scheduleSync();
    await new Promise(s => setTimeout(s, 4000));
    return { dirty: readDirty().length, chip: document.getElementById('syncChip').dataset.state };
  });
  t('a normal write still syncs after rejected batches', recovered.dirty === 0 && recovered.chip === 'synced', JSON.stringify(recovered));

  /* ---------- typing while the app is being navigated hard ---------- */
  await p.evaluate(() => { setTab('train'); state.date = '2026-08-26'; renderSession(); });
  await p.waitForTimeout(400);
  const exId = await p.evaluate(() => document.querySelectorAll('.in-load')[0].dataset.ex);
  await p.locator('.in-load').nth(0).tap();
  await p.keyboard.press(SELECT_ALL);            // the field already holds that day's load
  await p.keyboard.type('137');
  // Sequential on purpose: a person taps one tab at a time, fast.
  /* eslint-disable no-await-in-loop */
  for (const tab of ['fuel', 'progress', 'train', 'fuel', 'train']) {
    await p.locator(`.tab[data-tab="${tab}"]`).tap();
    await p.waitForTimeout(120);
  }
  /* eslint-enable no-await-in-loop */
  await p.waitForTimeout(600);
  const raced = await p.evaluate(id => setsFor('jt', '2026-08-26', id).map(s => s.load), exId);
  t('a set value typed then hammered through tabs survives without changing other sets',
    raced[0] === '137' && raced.slice(1).every(load => load !== '137'), JSON.stringify(raced));

  /* ---------- export at full volume ---------- */
  const exported = await p.evaluate(() => fetch('./api/export?ns=gym').then(r => r.json()).then(d => ({ count: d.count, keys: Object.keys(d.data).length })));
  t('export returns the whole namespace', exported.count === exported.keys && exported.count > 1500, JSON.stringify(exported));

  t('no page errors on either device', errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(' | '));

  console.log(JSON.stringify({ results: R }, null, 1));
  await ctx2.close();
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
