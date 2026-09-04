// Drive the Coach like a person while a deterministic SSE fixture stands in for
// free-model availability. The browser still parses the real protocol, renders the
// Beautiful UI transcript and Approval Cards, and commits only after a real tap.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);

const DATE = '2026-08-24';
const EXERCISE_ID = 'lat-pulldown';
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const prompts = [];
  let removalIds = null;

  await page.route('**/api/me?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ email: 'parity@local', dev: true, ns: 'gym' })
  }));
  await page.route('**/api/sync?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 0, changes: [] })
  }));
  await page.route('**/api/food?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      estimated: true,
      foods: [{
        id: 'wfm-hotbar-chicken',
        name: 'Whole Foods Hot Bar — chicken breast (estimate)',
        brand: 'Whole Foods Hot Bar · estimate',
        kind: 'Built-in estimate',
        protein100: 31, carbs100: 0, fat100: 3.6,
        kcal100: 165,
        servingGrams: 113,
        portions: [{ label: '4 oz', grams: 113 }]
      }]
    })
  }));
  await page.route('**/api/agent/status?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      connected: true,
      source: 'workspace',
      model: 'openrouter/free',
      capabilities: {
        proposalTypes: ['set', 'meal', 'supplement', 'bodyweight', 'habit', 'steps', 'profile', 'removal'],
        uiActionTypes: ['navigate', 'interface'],
        readTools: ['training_snapshot', 'food_catalog']
      },
      privacy: { dataCollection: 'deny', zeroDataRetention: false }
    })
  }));
  await page.route('**/api/agent/reset?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"reset":true}'
  }));
  await page.route('**/api/agent/chat?*', async route => {
    const body = route.request().postDataJSON();
    prompts.push(body);
    const lower = body.prompt.toLowerCase();
    let frames = event('meta', { model: 'acceptance-model', provider: 'OpenRouter', framework: 'Pi' });
    if (lower.includes('log every type')) {
      const proposals = [
        { kind: 'set', date: DATE, exerciseId: EXERCISE_ID, exerciseName: 'Lat pulldown', setNumber: 1,
          load: 135, reps: 6, drops: [{ load: 95, reps: 4 }] },
        { kind: 'meal', date: DATE, name: 'Whole Foods Hot Bar chicken', protein: 42, carbs: 48, fat: 16, kcal: 510, estimate: true },
        { kind: 'supplement', date: DATE, name: 'Creatine monohydrate', dose: 5, unit: 'g' },
        { kind: 'bodyweight', date: DATE, value: 198.4, unit: 'lb' },
        { kind: 'habit', date: DATE, habit: 'sleep', done: true },
        { kind: 'steps', date: DATE, value: 11240 },
        { kind: 'profile', weight: 198.4, unit: 'lb', heightCm: 178, experience: 'returning',
          dailySteps: 10000, mealsPerDay: 4, freeMealsPerWeek: 2 }
      ];
      frames += event('tool', { name: 'get_training_snapshot' });
      proposals.forEach(proposal => { frames += event('proposal', proposal); });
      frames += event('delta', { text: 'I prepared each record for your approval.' });
    } else if (lower.includes('remove the records')) {
      const proposals = [
        { kind: 'removal', date: DATE, recordKind: 'set', exerciseId: EXERCISE_ID, setNumber: 1, label: 'Lat pulldown set 1' },
        { kind: 'removal', date: DATE, recordKind: 'meal', recordId: removalIds.meal, label: 'Whole Foods Hot Bar chicken' },
        { kind: 'removal', date: DATE, recordKind: 'supplement', recordId: removalIds.supplement, label: 'Creatine monohydrate' }
      ];
      frames += event('tool', { name: 'get_training_snapshot' });
      proposals.forEach(proposal => { frames += event('proposal', proposal); });
      frames += event('delta', { text: 'I found those exact records.' });
    } else if (lower.includes('planned day 1')) {
      frames += event('tool', { name: 'open_training_surface' });
      frames += event('ui_action', { kind: 'navigate', surface: 'workout', date: '2026-09-07' });
      frames += event('delta', { text: 'Opening planned Day 1.' });
    } else if (lower.includes('open food')) {
      frames += event('tool', { name: 'open_training_surface' });
      frames += event('ui_action', { kind: 'navigate', surface: 'food', date: '2026-08-23' });
      frames += event('delta', { text: 'Opening that Food day.' });
    } else if (lower.includes('search food')) {
      frames += event('tool', { name: 'control_training_interface' });
      frames += event('ui_action', {
        kind: 'interface', action: 'food_search', value: 'Whole Foods Hot Bar chicken'
      });
      frames += event('delta', { text: 'Searching the shared Food catalog.' });
    } else if (lower.includes('open importer')) {
      frames += event('tool', { name: 'control_training_interface' });
      frames += event('ui_action', {
        kind: 'interface', action: 'import_notes',
        value: 'Dumbbell incline press 40 x 8\nDumbbell incline press 35 x 8'
      });
      frames += event('delta', { text: 'Opening a reviewable import preview.' });
    } else if (lower.includes('start rest timer')) {
      frames += event('tool', { name: 'control_training_interface' });
      frames += event('ui_action', { kind: 'interface', action: 'timer_start' });
      frames += event('delta', { text: 'Starting the rest timer.' });
    } else if (lower.includes('context check')) {
      frames += event('delta', { text: 'I received the active product context.' });
    } else {
      frames += event('proposal', { kind: 'set', date: DATE, exerciseId: '../bad:id', exerciseName: 'Bad set',
        setNumber: 1, load: 100, reps: 10 });
      frames += event('proposal', { kind: 'bodyweight', date: DATE, value: 2, unit: 'lb' });
      frames += event('delta', { text: 'These drafts should be rejected by the app.' });
    }
    frames += event('done', { model: 'acceptance-model' });
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });

  await page.goto('http://127.0.0.1:8911/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="agent"]').tap();
  await page.waitForFunction(() => document.querySelector('#agentConnection')?.textContent === 'Connected');

  const ask = async prompt => {
    await page.locator('#agentPrompt').tap();
    await page.keyboard.type(prompt);
    await page.locator('#agentSend').tap();
    await page.waitForFunction(() => document.querySelector('#agentLiveStatus')?.textContent.includes('Answered'));
  };

  await ask('Log every type of record for my workout.');
  const apply = page.locator('.agent-proposal:not([data-applied])').getByRole('button', { name: 'Apply to my log' });
  const draftCount = await apply.count();
  t('coach can draft every manual record type from a typed prompt', draftCount === 7, String(draftCount));
  for (let index = 0; index < draftCount; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await apply.first().tap();
  }
  await page.waitForTimeout(300);

  const saved = await page.evaluate(({ date, exerciseId }) => {
    const keys = Object.keys(localStorage);
    const mealKey = keys.find(key => key.startsWith(`jt-lupe:jt:meal:${date}:`));
    const supplementKey = keys.find(key => key.startsWith(`jt-lupe:jt:supplement:${date}:`));
    return {
      set: JSON.parse(localStorage.getItem(`jt-lupe:jt:set:${date}:${exerciseId}:1`)),
      session: JSON.parse(localStorage.getItem(`jt-lupe:jt:session:${date}`)),
      meal: mealKey ? JSON.parse(localStorage.getItem(mealKey)) : null,
      mealId: mealKey?.split(':').at(-1),
      supplement: supplementKey ? JSON.parse(localStorage.getItem(supplementKey)) : null,
      supplementId: supplementKey?.split(':').at(-1),
      bodyweight: JSON.parse(localStorage.getItem(`jt-lupe:jt:bodyweight:${date}`)),
      sleep: JSON.parse(localStorage.getItem(`jt-lupe:jt:habit:${date}:sleep`)),
      steps: JSON.parse(localStorage.getItem(`jt-lupe:jt:steps:${date}`)),
      profile: JSON.parse(localStorage.getItem('jt-lupe:jt:profile')),
      receipts: keys.filter(key => key.startsWith('jt-lupe:jt:activity:')).length
    };
  }, { date: DATE, exerciseId: EXERCISE_ID });
  removalIds = { meal: saved.mealId, supplement: saved.supplementId };
  t('approved coach drafts save through the same record system',
    saved.set?.load === 135 && saved.set?.drops?.[0]?.load === 95 && saved.session
      && saved.meal?.protein === 42 && saved.supplement?.dose === 5
      && saved.bodyweight?.value === 198.4 && saved.sleep?.done === true && saved.steps?.value === 11240
      && saved.profile?.dailySteps === 10000 && saved.receipts === 7,
    JSON.stringify(saved));

  await ask('Remove the records I just logged.');
  const removalButtons = page.locator('.agent-proposal:not([data-applied])').getByRole('button', { name: 'Apply to my log' });
  const removalCount = await removalButtons.count();
  t('coach can find exact removable records from a typed prompt', removalCount === 3, String(removalCount));
  for (let index = 0; index < removalCount; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await removalButtons.first().tap();
  }
  const removed = await page.evaluate(({ date, exerciseId }) => ({
    set: localStorage.getItem(`jt-lupe:jt:set:${date}:${exerciseId}:1`),
    meals: Object.keys(localStorage).filter(key => key.startsWith(`jt-lupe:jt:meal:${date}:`)).length,
    supplements: Object.keys(localStorage).filter(key => key.startsWith(`jt-lupe:jt:supplement:${date}:`)).length,
    receipts: Object.keys(localStorage).filter(key => key.startsWith('jt-lupe:jt:activity:')).length
  }), { date: DATE, exerciseId: EXERCISE_ID });
  t('approved removal drafts remove only the named records',
    removed.set === null && removed.meals === 0 && removed.supplements === 0 && removed.receipts === 10,
    JSON.stringify(removed));

  await ask('Open Food for August 23.');
  const navigation = await page.evaluate(() => ({
    selected: document.querySelector('[data-tab="fuel"]').getAttribute('aria-selected'),
    date: document.querySelector('#fuelDate').value,
    heading: document.querySelector('#panel-fuel h2').textContent
  }));
  t('coach can drive the dated UI from a typed prompt',
    navigation.date === '2026-08-23' && navigation.selected === 'true' && navigation.heading === 'Food',
    JSON.stringify(navigation));

  await page.locator('.tab[data-tab="agent"]').tap();
  await ask('Open planned Day 1 workout.');
  const plannedNavigation = await page.evaluate(() => ({
    date: state.date,
    selected: document.querySelector('[data-tab="train"]').getAttribute('aria-selected'),
    title: document.querySelector('#sessionTitle').textContent,
    challenge: document.querySelector('#challengeLine').textContent,
    flag: document.querySelector('#backfillFlag').textContent
  }));
  t('coach can open the same future Day 1 planning surface as the direct UI',
    plannedNavigation.date === '2026-09-07' && plannedNavigation.selected === 'true'
      && /Monday/.test(plannedNavigation.title) && /Day 1 of 60/i.test(plannedNavigation.challenge)
      && (plannedNavigation.flag === '' || /Planned for Monday|Catching up/i.test(plannedNavigation.flag)),
    JSON.stringify(plannedNavigation));

  await page.locator('.tab[data-tab="agent"]').tap();
  await ask('Search food for Whole Foods Hot Bar chicken.');
  await page.waitForFunction(() => document.querySelector('#foodResults')?.textContent.includes('Whole Foods Hot Bar'));
  const foodSearch = await page.evaluate(() => ({
    query: document.querySelector('#foodQuery').value,
    results: document.querySelector('#foodResults').textContent,
    selected: document.querySelector('[data-tab="fuel"]').getAttribute('aria-selected')
  }));
  t('coach passes a query into the same Food search control',
    foodSearch.query === 'Whole Foods Hot Bar chicken' && foodSearch.results.includes('generic estimates')
      && foodSearch.selected === 'true', JSON.stringify(foodSearch));

  await page.locator('.tab[data-tab="agent"]').tap();
  await ask('Open importer with these notes.');
  const imported = await page.evaluate(() => ({
    notes: document.querySelector('#importText').value,
    preview: document.querySelector('#importResult').textContent,
    open: document.querySelector('#importBlock').open,
    selected: document.querySelector('[data-tab="train"]').getAttribute('aria-selected')
  }));
  t('coach passes workout notes into the same review-first importer',
    imported.notes.includes('Dumbbell incline press 40 x 8') && imported.preview.includes('Dumbbell incline press')
      && imported.preview.includes('2 of 2 lines matched')
      && imported.open === true && imported.selected === 'true', JSON.stringify(imported));

  await page.locator('.tab[data-tab="agent"]').tap();
  await ask('Try unsafe drafts.');
  await page.locator('.agent-proposal').filter({ hasText: 'Bad set' }).getByRole('button', { name: 'Apply to my log' }).tap();
  await page.locator('.agent-proposal').filter({ hasText: '2 lb' }).getByRole('button', { name: 'Apply to my log' }).tap();
  const rejected = await page.evaluate(date => ({
    malformedSet: Object.keys(localStorage).some(key => key.includes('../bad:id')),
    bodyweight: JSON.parse(localStorage.getItem(`jt-lupe:jt:bodyweight:${date}`)),
    receipts: Object.keys(localStorage).filter(key => key.startsWith('jt-lupe:jt:activity:')).length
  }), DATE);
  t('untrusted model drafts cannot bypass direct-UI value constraints',
    rejected.malformedSet === false && rejected.bodyweight?.value === 198.4 && rejected.receipts === 10,
    JSON.stringify(rejected));

  await ask('Start rest timer.');
  const timer = await page.evaluate(() => ({
    running: document.querySelector('#timerFab').dataset.running,
    label: document.querySelector('#timerToggle').textContent,
    workoutSelected: document.querySelector('[data-tab="train"]').getAttribute('aria-selected')
  }));
  t('coach drives routine UI controls through their existing handlers',
    timer.running === 'true' && timer.label === 'Pause' && timer.workoutSelected === 'true', JSON.stringify(timer));
  await page.locator('#timerReset').tap();

  const askGlobal = async prompt => {
    const expectedRequests = prompts.length + 1;
    await page.locator('#globalAgentPrompt').fill(prompt);
    await page.locator('#globalAgentForm button[type="submit"]').tap();
    for (let attempt = 0; attempt < 50 && prompts.length < expectedRequests; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(50);
    }
    if (prompts.length < expectedRequests) throw new Error(`global Prompt Bar did not send: ${prompt}`);
    await page.waitForFunction(() => document.querySelector('#agentLiveStatus')?.textContent.includes('Answered'));
    await page.waitForFunction(() => document.querySelector('#agentSend')?.disabled === false);
  };

  await page.locator('.tab[data-tab="train"]').tap();
  await page.locator('#prevDay').tap();
  const workoutDate = await page.evaluate(() => localStorage.getItem('jt-lupe-active-date'));
  await askGlobal('Context check workout.');

  await page.locator('.tab[data-tab="fuel"]').tap();
  await page.locator('#fuelDate').fill('2026-08-20');
  await page.locator('#fuelDate').dispatchEvent('change');
  await askGlobal('Context check food.');

  await page.locator('.tab[data-tab="supplements"]').tap();
  await page.locator('#supplementDate').fill('2026-08-19');
  await page.locator('#supplementDate').dispatchEvent('change');
  await askGlobal('Context check supplements.');

  await page.locator('.tab[data-tab="progress"]').tap();
  await askGlobal('Context check progress.');

  const contextPrompts = prompts.filter(row => row.prompt.startsWith('Context check'));
  t('global Prompt Bar hands the active surface, date, and workout session to Coach',
    contextPrompts.length === 4
      && contextPrompts[0].uiContext?.surface === 'workout'
      && contextPrompts[0].uiContext?.date === workoutDate
      && Boolean(contextPrompts[0].uiContext?.session?.id)
      && contextPrompts[1].uiContext?.surface === 'food'
      && contextPrompts[1].uiContext?.date === '2026-08-20'
      && contextPrompts[2].uiContext?.surface === 'supplements'
      && contextPrompts[2].uiContext?.date === '2026-08-19'
      && contextPrompts[3].uiContext?.surface === 'progress'
      && /^\d{4}-\d{2}-\d{2}$/.test(contextPrompts[3].uiContext?.date || '')
      && !('session' in contextPrompts[3].uiContext),
    JSON.stringify(contextPrompts));

  t('real prompt requests preserve the active profile', prompts.length === 12 && prompts.every(row => row.profile === 'jt'), JSON.stringify(prompts));
  t('agent approval flow has no page errors', errors.length === 0, errors.join(' | '));

  console.log(JSON.stringify({ results: R }, null, 1));
  await browser.close();
  process.exit(R.some(result => result.startsWith('FAIL')) ? 1 : 0);
})().catch(error => { console.error('FAILED:', error.message); process.exit(1); });
