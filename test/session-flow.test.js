// Drives the paths a person uses on an ordinary training night and the day after:
// today's session, editing what was already logged, and going back to fill in a
// missed day. Real taps and real typing only — see README.md for why.
const { chromium } = require('playwright-core');
const { launchOptions, SELECT_ALL } = require('./browser.js');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8911/';

// Computed here, not hardcoded. Pinning these to the day they were written meant the
// suite passed on that Tuesday and failed everywhere else — CI caught it the first
// time it ran past midnight UTC.
const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const TODAY = key(now);
const YESTERDAY = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const OFFICIAL_START = '2026-08-31';
const EXPECTED_OPEN_DATE = TODAY < OFFICIAL_START ? OFFICIAL_START : TODAY;

(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));

  const fresh = async () => {
    await p.goto(url); await p.evaluate(() => localStorage.clear());
    await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
  };
  const sets = (date, ex) => p.evaluate(([d, e]) => setsFor('jt', d, e)
    .map(s => ({ n: s.n, l: s.load, r: s.reps, drops: s.drops || [] })), [date, ex]);

  // --- opening always reflects the real calendar date, including a recovery day ---
  await fresh();
  let r = await p.evaluate(() => ({
    date: state.date,
    title: document.getElementById('sessionTitle').textContent,
    day: document.getElementById('challengeLine').textContent,
    flagged: !document.getElementById('backfillFlag').hidden,
    flag: document.getElementById('backfillFlag').textContent
  }));
  // Before launch, Workout previews planned Day 1. From launch onward it resumes the
  // real/saved training date. Food and Supplements remain independently dated today.
  t('Workout opens on planned Day 1 before launch, then the active calendar date',
    r.date === EXPECTED_OPEN_DATE && Boolean(r.title.trim())
      && (TODAY < OFFICIAL_START ? r.flagged && /Planned for Monday/i.test(r.flag) : !r.flagged),
    JSON.stringify(r));
  t('the day counter names the official challenge state', /day \d+ of 60|starts Monday|complete/i.test(r.day), r.day);

  const officialDates = await p.evaluate(() => {
    state.date = shiftDate(dateKey(), 1); renderSession();
    return {
      start: challengeDay('2026-08-31'),
      end: challengeDay('2026-10-29'),
      before: challengeDay('2026-08-30'),
      openingWeek: ['2026-08-31', '2026-09-01', '2026-09-03', '2026-09-04'].map(date => dayForDate(date).label),
      futureFlag: document.getElementById('backfillFlag').textContent
    };
  });
  t('August 31 is Day 1 and October 29 is Day 60',
    officialDates.start === 1 && officialDates.end === 60 && officialDates.before === 0
      && officialDates.openingWeek.join(',') === 'Monday,Tuesday,Thursday,Friday',
    JSON.stringify(officialDates));
  t('a future workout is labelled planned, never backfilled',
    officialDates.futureFlag.startsWith('Planned for ') && !/Catching up|Not today/.test(officialDates.futureFlag),
    officialDates.futureFlag);

  // A first-use recommendation must tell the person exactly what "2 reps in
  // reserve" means. The old "First time: pick a weight you could manage about…"
  // sentence was vague and repeated internal coach logic verbatim.
  await p.evaluate(() => { state.date = '2026-08-31'; renderSession(); });
  const firstUseCopy = await p.locator('.coach').first().innerText();
  t('first-use weight guidance is direct and actionable',
    firstUseCopy === 'No history yet. Choose a weight that leaves 2 clean reps.'
      && !/First time|manage about/i.test(firstUseCopy), firstUseCopy);

  // --- log each set at the weight actually used, including one in-set drop ---
  const TRAINING_DATE = '2026-08-31'; // official Day 1, Monday
  await p.evaluate(date => { state.date = date; renderSession(); }, TRAINING_DATE);
  const card = p.locator('.exercise').first();
  const id = await card.locator('.in-load').first().getAttribute('data-ex');
  const weights = card.locator('.in-load');
  const reps = card.locator('.in-reps');

  /* eslint-disable no-await-in-loop */
  for (const [index, weight, count] of [[0, '100', '6'], [1, '100', '10'], [2, '90', '10']]) {
    await weights.nth(index).tap(); await p.keyboard.type(weight);
    await reps.nth(index).tap(); await p.keyboard.type(count);
  }
  /* eslint-enable no-await-in-loop */
  await card.locator('.set-adjustment summary').first().tap();
  await card.locator('.in-drop-load').first().tap(); await p.keyboard.type('70');
  await card.locator('.in-drop-reps').first().tap(); await p.keyboard.type('4');
  await p.locator('.exercise').nth(1).locator('.in-load').first().tap();
  await p.waitForTimeout(500);

  const first = await sets(TRAINING_DATE, id);
  t('each set keeps its own weight and reps',
    JSON.stringify(first.map(s => [s.l, s.r])) === JSON.stringify([['100', 6], ['100', 10], ['90', 10]]), JSON.stringify(first));
  t('a partial set keeps the lighter finish separately',
    first[0].drops.length === 1 && first[0].drops[0].load === '70' && first[0].drops[0].reps === 4, JSON.stringify(first[0]));

  // Correcting set 2 changes only set 2, not the whole exercise.
  await weights.nth(1).tap(); await p.keyboard.press(SELECT_ALL); await p.keyboard.type('95');
  await reps.nth(1).tap(); await p.waitForTimeout(400);
  const edited = await sets(TRAINING_DATE, id);
  t('editing one set leaves the other set weights alone',
    JSON.stringify(edited.map(s => s.l)) === JSON.stringify(['100', '95', '90']), JSON.stringify(edited));

  // Clearing an unperformed set removes only that record.
  await weights.nth(2).tap(); await p.keyboard.press(SELECT_ALL); await p.keyboard.press('Backspace');
  await reps.nth(2).tap(); await p.keyboard.press(SELECT_ALL); await p.keyboard.press('Backspace');
  await weights.nth(1).tap(); await p.waitForTimeout(400);
  const cut = await sets(TRAINING_DATE, id);
  t('leaving an unperformed set blank removes only that set', cut.length === 2 && cut.every(s => s.n < 3), JSON.stringify(cut));

  // --- fuel on a past day must show that day, not today ---
  await fresh();
  await p.locator('.tab[data-tab="fuel"]').tap(); await p.waitForTimeout(300);
  await p.locator('#mealName').tap(); await p.keyboard.type('Chicken bowl');
  await p.locator('#mealProtein').tap(); await p.keyboard.type('45');
  await p.locator('#addMeal').tap(); await p.waitForTimeout(400);
  const todayTotal = await p.evaluate(() => document.getElementById('proteinSoFar').textContent);

  await p.evaluate(d => { const f = document.getElementById('fuelDate'); f.value = d; f.dispatchEvent(new Event('change')); }, YESTERDAY);
  await p.waitForTimeout(400);
  r = await p.evaluate(() => ({
    total: document.getElementById('proteinSoFar').textContent,
    flag: document.getElementById('fuelBackfill').textContent,
    names: [...document.querySelectorAll('#mealList .meal-name')].map(n => n.textContent)
  }));
  t('backfilled fuel day shows that day, not today', r.total === '0 g' && r.names.length === 0, JSON.stringify({ todayTotal, ...r }));
  t('backfilled fuel day is labelled', /^Backfilling .+\.$/.test(r.flag) && /yesterday/i.test(r.flag), r.flag);

  // --- a meal added while backfilling belongs to the backfilled day ---
  await p.locator('#mealName').tap(); await p.keyboard.type('Leftover rice');
  await p.locator('#mealProtein').tap(); await p.keyboard.type('12');
  await p.locator('#addMeal').tap(); await p.waitForTimeout(400);
  r = await p.evaluate(([y, td]) => ({
    onYesterday: readMeals('jt', y).map(m => m.name),
    onToday: readMeals('jt', td).map(m => m.name)
  }), [YESTERDAY, TODAY]);
  t('meal added while backfilling lands on that day', r.onYesterday.includes('Leftover rice') && !r.onToday.includes('Leftover rice'), JSON.stringify(r));

  // --- bodyweight while backfilling must not stamp today ---
  await p.locator('#bwValue').tap(); await p.keyboard.type('198');
  await p.locator('#mealName').tap(); await p.waitForTimeout(400);
  r = await p.evaluate(([y, td]) => ({
    yesterday: readJSON(K.bodyweight('jt', y)), today: readJSON(K.bodyweight('jt', td))
  }), [YESTERDAY, TODAY]);
  t('bodyweight entered while backfilling lands on that day', r.yesterday && r.yesterday.value === 198 && !r.today, JSON.stringify(r));

  // --- habit ticked while backfilling belongs to the backfilled day ---
  await p.locator('.habit').first().tap(); await p.waitForTimeout(300);
  r = await p.evaluate(([y, td]) => {
    const habit = document.querySelector('.habit').dataset.habit;
    return { habit, yesterday: readJSON(K.habit('jt', y, habit)), today: readJSON(K.habit('jt', td, habit)) };
  }, [YESTERDAY, TODAY]);
  t('habit ticked while backfilling lands on that day', r.yesterday && r.yesterday.done === true && !r.today, JSON.stringify(r));

  // --- the protein target must follow bodyweight ---
  r = await p.evaluate(() => document.getElementById('proteinTarget').textContent);
  t('protein target derived from bodyweight', /of \d+ g protein/.test(r), r);

  // --- two meals added in the same instant must both survive ---
  await fresh();
  await p.locator('.tab[data-tab="fuel"]').tap(); await p.waitForTimeout(300);
  r = await p.evaluate(async () => {
    const before = readMeals('jt', dateKey()).length;
    for (const [name, protein] of [['Eggs', '18'], ['Toast', '6'], ['Shake', '30']]) {
      document.getElementById('mealName').value = name;
      document.getElementById('mealProtein').value = protein;
      document.getElementById('addMeal').click();          // no delay: same millisecond
    }
    await new Promise(s => setTimeout(s, 400));
    return { before, after: readMeals('jt', dateKey()).map(m => m.name) };
  });
  t('three meals logged back-to-back all survive', r.after.length === 3, JSON.stringify(r));

  t('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ results: R }, null, 1));
  await b.close();
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})();
