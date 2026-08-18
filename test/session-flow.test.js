// Drives the paths a person uses on an ordinary training night and the day after:
// today's session, editing what was already logged, and going back to fill in a
// missed day. Real taps and real typing only — see README.md for why.
const { chromium } = require('playwright-core');
const R = []; const t = (n, ok, d = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  -> ${d}` : ''}`);
const url = 'http://127.0.0.1:8911/';
const TODAY = '2026-08-18';        // Tuesday, day 2
const YESTERDAY = '2026-08-17';

(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));

  const fresh = async () => {
    await p.goto(url); await p.evaluate(() => localStorage.clear());
    await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
  };
  const sets = (date, ex) => p.evaluate(([d, e]) => setsFor('jt', d, e).map(s => ({ l: s.load, r: s.reps })), [date, ex]);
  const exId = i => p.evaluate(n => document.querySelectorAll('.in-load')[n].dataset.ex, i);

  // --- today is Tuesday: the app must open on legs, day 2 ---
  await fresh();
  let r = await p.evaluate(() => ({
    title: document.getElementById('sessionTitle').textContent,
    day: document.getElementById('challengeLine').textContent,
    flagged: !document.getElementById('backfillFlag').hidden
  }));
  t('opens on today, not flagged as catching up', /Tuesday/i.test(r.title) && /day 2 of 60/i.test(r.day) && !r.flagged, JSON.stringify(r));

  // --- log one exercise the way a person does, then change their mind ---
  let id = await exId(0);
  await p.locator('.in-load').nth(0).tap(); await p.keyboard.type('95');
  await p.locator('.in-reps').nth(0).tap(); await p.keyboard.type('10');
  await p.locator('.in-load').nth(1).tap(); await p.waitForTimeout(400);
  const first = await sets(TODAY, id);

  // correct the weight after the fact: the record must change, not accumulate
  await p.locator('.in-load').nth(0).tap();
  await p.keyboard.press('Meta+A'); await p.keyboard.type('105');
  await p.locator('.in-reps').nth(0).tap(); await p.waitForTimeout(400);
  const edited = await sets(TODAY, id);
  t('editing a logged weight replaces it', edited.length === first.length && edited.every(s => s.l === '105'), JSON.stringify({ first, edited }));

  // --- cut the set count from 3 to 2: the third record must be gone ---
  await p.locator('.in-sets').nth(0).tap();
  await p.keyboard.press('Meta+A'); await p.keyboard.type('2');
  await p.locator('.in-load').nth(1).tap(); await p.waitForTimeout(400);
  const cut = await sets(TODAY, id);
  t('cutting sets 3 -> 2 removes the third record', cut.length === 2, JSON.stringify(cut));

  // --- a garbage set count must not wipe the exercise ---
  await p.locator('.in-sets').nth(0).tap();
  await p.keyboard.press('Meta+A'); await p.keyboard.type('abc');
  await p.locator('.in-load').nth(1).tap(); await p.waitForTimeout(400);
  const junk = await sets(TODAY, id);
  t('garbage set count falls back to one set, keeps the load', junk.length >= 1 && junk[0].l === '105', JSON.stringify(junk));

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
  t('backfilled fuel day is labelled', /yesterday/i.test(r.flag), r.flag);

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
  t('protein target derived from bodyweight', /\d+–\d+ g/.test(r), r);

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
