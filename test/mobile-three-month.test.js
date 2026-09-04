// A 90-day, phone-sized rehearsal against the real Worker. This deliberately uses
// its own namespace, drives the coach through a deterministic SSE fixture, and
// deletes every remote record before asserting the empty state at the end.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');

const RESULTS = [];
const test = (name, ok, detail = '') => RESULTS.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
const namespace = 'three-month-mobile';
const url = `http://127.0.0.1:8777/?ns=${namespace}`;
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
const endDate = key(today);
const startDate = key(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89));
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function waitForSynced(page) {
  await page.waitForFunction(() => ['synced', 'local', 'offline', 'error'].includes(document.getElementById('syncChip').dataset.state), null, { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  // The local test environment has no production OpenRouter secret. The route is
  // still the real mobile UI and SSE parser; only model availability is deterministic.
  await page.route('**/api/agent/status?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      connected: true,
      source: 'workspace',
      model: 'openrouter/free',
      capabilities: { proposalTypes: ['set', 'meal', 'supplement', 'bodyweight', 'habit', 'steps', 'profile', 'removal'], uiActionTypes: ['navigate', 'interface'], readTools: ['training_snapshot', 'food_catalog'] },
      privacy: { dataCollection: 'allow', zeroDataRetention: false }
    })
  }));
  await page.route('**/api/agent/reset?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"reset":true}' }));
  await page.route('**/api/agent/chat?*', async route => {
    const body = route.request().postDataJSON();
    const date = body?.uiContext?.date || endDate;
    const frames = frame('meta', { model: 'mobile-three-month-fixture', provider: 'OpenRouter', framework: 'Pi' })
      + frame('tool', { name: 'get_training_snapshot' })
      + frame('proposal', {
        kind: 'set', date, exerciseId: 'dumbbell-incline-press', exerciseName: 'Dumbbell incline press', setNumber: 1,
        load: 52.5, reps: 6, drops: [{ load: 40, reps: 4 }]
      })
      + frame('delta', { text: 'I drafted the set with the lighter finish kept separate.' })
      + frame('done', { model: 'mobile-three-month-fixture' });
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });

  const resetRemote = async () => page.evaluate(async ns => {
    const exportResponse = await fetch(`./api/export?ns=${ns}`);
    const dump = await exportResponse.json();
    const keys = Object.keys(dump.data || {});
    const statuses = [];
    for (let index = 0; index < keys.length; index += 1800) {
      const changes = keys.slice(index, index + 1800).map(recordKey => ({ key: recordKey, deleted: true }));
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`./api/sync?ns=${ns}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: dump.version, device: 'three-month-reset', changes })
      });
      statuses.push(response.status);
    }
    await fetch(`./api/agent/reset?ns=${ns}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    localStorage.clear();
    const stats = await fetch(`./api/stats?ns=${ns}`).then(response => response.json());
    const cleared = await fetch(`./api/export?ns=${ns}`).then(response => response.json());
    return { keys: keys.length, statuses, stats, cleared, localRecords: Object.keys(localStorage).filter(recordKey => recordKey.startsWith('jt-lupe:')).length };
  }, namespace);

  try {
    await page.goto(url);
    await waitForSynced(page);
    await page.evaluate(() => localStorage.clear());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForSynced(page);

    const seeded = await page.evaluate(({ start }) => {
      const first = new Date(`${start}T12:00:00`);
      const counts = { days: 90, sets: 0, meals: 0, supplements: 0, bodyweight: 0, habits: 0, steps: 0 };
      for (const profile of ['jt', 'lupe']) {
        writeJSON(K.profile(profile), {
          weight: 198, unit: 'lb', heightCm: 178, experience: 'returning', dailySteps: 10000,
          mealsPerDay: 4, freeMealsPerWeek: 2, targets: { calories: 2500, protein: 198, fat: 70, carbs: 285, weeklySteps: 70000 }
        });
      }
      for (let offset = 0; offset < 90; offset += 1) {
        const date = new Date(first);
        date.setDate(first.getDate() + offset);
        const dateString = dateKey(date);
        const plan = dayForDate(dateString);
        for (const profile of ['jt', 'lupe']) {
          for (const exercise of plan.exercises) {
            for (let setNumber = 1; setNumber <= (exercise.sets || 3); setNumber += 1) {
              const timed = exercise.kind === 'timed';
              const partial = !timed && setNumber === 1 && offset % 7 === 0;
              writeSet(profile, dateString, exercise.id, setNumber, {
                load: timed ? 'bodyweight' : String(100 + (offset % 20) + setNumber),
                unit: timed ? 'bodyweight' : 'lb',
                reps: timed ? null : partial ? 6 : 10,
                seconds: timed ? 45 : null,
                rir: partial ? 0 : 2,
                drops: partial ? [{ load: String(70 + (offset % 10)), reps: 4 }] : []
              });
              counts.sets += 1;
            }
          }
          writeJSON(K.meal(profile, dateString, `three-month-${offset}`), {
            name: offset % 3 === 0 ? 'Whole Foods Hot Bar chicken (estimate)' : 'Chicken and rice',
            protein: 42 + (offset % 5), carbs: 48, fat: 16, kcal: 510, estimate: offset % 3 === 0
          });
          counts.meals += 1;
          writeJSON(K.supplement(profile, dateString, `three-month-${offset}`), {
            name: offset % 2 === 0 ? 'Optimum Nutrition Extreme Milk Chocolate' : 'Optimum Nutrition Creatine Pills',
            dose: offset % 2 === 0 ? 1 : 4,
            unit: offset % 2 === 0 ? 'serving' : 'capsule',
            at: new Date(date.getTime() + 12 * 60 * 60 * 1000).toISOString()
          });
          counts.supplements += 1;
          writeJSON(K.bodyweight(profile, dateString), { value: 198 - offset * 0.04, unit: 'lb' });
          counts.bodyweight += 1;
          for (const habit of ['protein', 'preworkout', 'sleep']) {
            writeJSON(K.habit(profile, dateString, habit), { done: offset % 11 !== 0 });
            counts.habits += 1;
          }
          writeJSON(K.steps(profile, dateString), { value: 9000 + (offset % 5) * 500 });
          counts.steps += 1;
        }
      }
      return {
        ...counts,
        localRecords: Object.keys(localStorage).filter(recordKey => recordKey.startsWith('jt-lupe:')).length,
        dirty: readDirty().length
      };
    }, { start: startDate });
    test('seeded 90 days for both profiles with every record type', seeded.days === 90 && seeded.sets > 1800
      && seeded.meals === 180 && seeded.supplements === 180 && seeded.bodyweight === 180
      && seeded.habits === 540 && seeded.steps === 180 && seeded.dirty > 2500, JSON.stringify(seeded));

    await page.evaluate(() => scheduleSync());
    await page.waitForFunction(() => readDirty().length === 0, null, { timeout: 180000 });
    await waitForSynced(page);
    const server = await page.evaluate(ns => fetch(`./api/stats?ns=${ns}`).then(response => response.json()), namespace);
    test('the 90-day backlog syncs completely', server.records >= seeded.localRecords - 8,
      JSON.stringify({ server, local: seeded.localRecords }));

    const render = await page.evaluate(() => {
      const timings = {};
      for (const [name, tab, renderSurface] of [['train', 'train', renderSession], ['fuel', 'fuel', renderFuel], ['supplements', 'supplements', renderSupplements], ['progress', 'progress', renderProgress]]) {
        const started = performance.now();
        setTab(tab); renderSurface();
        timings[name] = Math.round(performance.now() - started);
      }
      return {
        timings,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        lifts: document.getElementById('statLifts').textContent,
        supplements: document.getElementById('supplementDays').textContent
      };
    });
    test('mobile surfaces render the full history without horizontal overflow', !render.overflow
      && Object.values(render.timings).every(milliseconds => milliseconds < 1500), JSON.stringify(render));
    test('progress and supplement summaries include the long run', Number(render.lifts.replace(/\D/g, '')) > 800
      && Number(render.supplements) >= 80, JSON.stringify(render));

    // Sequential taps mirror a person moving between surfaces on a phone.
    /* eslint-disable no-await-in-loop */
    for (const tab of ['train', 'fuel', 'supplements', 'progress', 'agent']) {
      await page.locator(`.tab[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(150);
    }
    /* eslint-enable no-await-in-loop */
    test('mobile tab navigation stays interactive', errors.length === 0, errors.join(' | '));

    await page.locator('#agentPrompt').tap();
    await page.keyboard.type('Review today and draft the set I just described.');
    await page.locator('#agentSend').tap();
    await page.waitForFunction(() => document.getElementById('agentLiveStatus')?.textContent.includes('Answered'), null, { timeout: 30000 });
    const draft = page.locator('.agent-proposal:not([data-applied])').getByRole('button', { name: 'Apply to my log' });
    test('mobile coach streams a reviewable draft', await draft.count() === 1);
    await draft.tap();
    await page.waitForTimeout(350);
    const approved = await page.evaluate(date => {
      const value = readJSON(K.set('jt', date, 'dumbbell-incline-press', 1));
      return { load: value?.load, reps: value?.reps, drops: value?.drops, createdBy: value?.createdBy };
    }, endDate);
    test('mobile coach approval preserves per-set drop data', approved.load === 52.5 && approved.reps === 6
      && approved.drops?.[0]?.load === 40 && approved.drops?.[0]?.reps === 4 && approved.createdBy === 'agent-approved', JSON.stringify(approved));
    await page.locator('#agentReset').tap();
    await page.waitForFunction(() => document.getElementById('agentLiveStatus')?.textContent === 'Conversation reset.');
    const resetView = await page.evaluate(() => ({
      empty: Boolean(document.getElementById('agentEmpty')),
      messages: document.querySelectorAll('.agent-message').length,
      drafts: document.querySelectorAll('.agent-proposal').length
    }));
    test('coach reset clears the visible conversation', resetView.empty && resetView.messages === 0 && resetView.drafts === 0, JSON.stringify(resetView));

    const reset = await resetRemote();
    test('remote reset deletes every 90-day record', reset.keys > 2500 && reset.statuses.every(status => status === 200)
      && reset.stats.records === 0 && reset.cleared.count === 0, JSON.stringify(reset));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSynced(page);
    const empty = await page.evaluate(() => ({
      records: Object.keys(localStorage).filter(recordKey => recordKey.startsWith('jt-lupe:')).length,
      lifts: document.getElementById('statLifts').textContent,
      supplementDays: document.getElementById('supplementDays').textContent,
      dirty: readDirty().length
    }));
    test('reload after reset is an empty mobile workspace', empty.records === 0 && empty.lifts.startsWith('0')
      && empty.supplementDays === '0' && empty.dirty === 0, JSON.stringify(empty));
    test('no mobile page errors across the long run', errors.length === 0, errors.join(' | '));
  } finally {
    // The runner also destroys its temporary Wrangler state, but this makes the
    // cleanup explicit if a browser assertion fails after seeding.
    await resetRemote().catch(() => {});
    await context.close();
    await browser.close();
  }

  console.log(JSON.stringify({ results: RESULTS }, null, 1));
  process.exit(RESULTS.some(result => result.startsWith('FAIL')) ? 1 : 0);
})().catch(error => { console.error('FAILED:', error.message); process.exit(1); });
