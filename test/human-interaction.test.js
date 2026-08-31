const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
const url='http://127.0.0.1:8911/';
(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
  const p = await ctx.newPage();
  const errors=[]; p.on('pageerror', e=>errors.push(String(e)));
  const fresh = async () => { await p.goto(url); await p.evaluate(()=>localStorage.clear());
    await p.goto(url,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1200);
    await p.evaluate(()=>{ state.date='2026-08-31'; state.profile='jt'; renderSession(); }); };
  const stored = (ex, date='2026-08-31') => p.evaluate(([id, key])=>setsFor('jt',key,id).map(s=>({l:s.load,r:s.reps})), [ex, date]);
  const card = i => p.locator('.exercise').nth(i);
  const field = (i, selector) => card(i).locator(selector).first();
  const exId = i => field(i, '.in-load').getAttribute('data-ex');

  // 1. real typing + tap the NEXT field
  await fresh();
  let id = await exId(1);
  await field(1, '.in-load').tap();
  await p.keyboard.type('140');
  await field(1, '.in-reps').tap();
  await p.keyboard.type('10');
  await field(2, '.in-load').tap();          // move focus away for real
  await p.waitForTimeout(500);
  t('type with a real keyboard, tap the next field', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 2. type then SWITCH TABS without blurring
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap();
  await p.keyboard.type('155');
  await p.locator('.tab[data-tab="fuel"]').tap();
  await p.waitForTimeout(600);
  t('type then switch tab', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 3. type then step to another DAY without blurring
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap();
  await p.keyboard.type('165');
  await p.locator('#prevDay').tap();
  await p.waitForTimeout(600);
  t('type then step to another day', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 4. type then RELOAD without blurring
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap();
  await p.keyboard.type('175');
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  t('type then reload the page', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 5. decimal weight
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap(); await p.keyboard.type('52.5');
  await field(1, '.in-reps').tap(); await p.keyboard.type('8');
  await field(2, '.in-load').tap(); await p.waitForTimeout(400);
  t('decimal weight 52.5 survives', JSON.stringify(await stored(id)).includes('52.5'), JSON.stringify(await stored(id)));

  // 6. comma decimal (European keyboards / some locales)
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap(); await p.keyboard.type('52,5');
  await field(2, '.in-load').tap(); await p.waitForTimeout(400);
  const commaRead = await p.evaluate(()=>numericLoad('52,5'));
  t('comma decimal read as 52.5 not 525', commaRead === 52.5, String(commaRead));

  // 7. rapid double-tap on done
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap(); await p.keyboard.type('100');
  await field(1, '.in-reps').tap(); await p.keyboard.type('8');
  await p.locator('.in-done').nth(1).tap();
  await p.locator('.in-done').nth(1).tap();
  await p.waitForTimeout(500);
  const after = await stored(id);
  t('double-tapping done does not duplicate or orphan',
    after.length===1 && after[0].l==='100' && after[0].r===8, JSON.stringify(after));

  // 8. paste instead of typing
  await fresh(); id = await exId(1);
  await field(1, '.in-load').tap();
  await p.evaluate(() => {
    const i=document.querySelectorAll('.exercise')[1].querySelector('.in-load');
    i.value='185'; i.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await p.locator('.tab[data-tab="progress"]').tap();
  await p.waitForTimeout(600);
  t('pasted value survives leaving the tab', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 9. rest timer keeps running across a tab switch
  await fresh();
  const timer = await p.evaluate(async () => {
    setTab('train'); document.getElementById('timerToggle').click();
    await new Promise(s=>setTimeout(s,2200));
    const mid = document.getElementById('timerDisplay').textContent;
    setTab('fuel'); await new Promise(s=>setTimeout(s,2200));
    setTab('train');
    return { mid, after: document.getElementById('timerDisplay').textContent };
  });
  t('rest timer keeps counting across tabs', timer.mid !== timer.after, JSON.stringify(timer));

  // 10. establish the working set once, then fill only the blank planned sets
  await fresh();
  await p.evaluate(() => { state.date='2026-09-01'; renderSession(); });
  id = await exId(0);
  await field(0, '.in-load').tap(); await p.keyboard.type('135');
  await field(0, '.in-reps').tap(); await p.keyboard.type('10');
  await card(0).locator('.fill-sets').tap();
  await p.waitForTimeout(500);
  const filled = await stored(id, '2026-09-01');
  t('fill blank sets from set one',
    filled.length===4 && filled.every(set => set.l==='135' && set.r===10), JSON.stringify(filled));

  // 11. filling blanks must not overwrite a set that was already changed
  await fresh();
  await p.evaluate(() => { state.date='2026-09-01'; renderSession(); });
  id = await exId(0);
  const changedSet = card(0).locator('.set-row').nth(2);
  await changedSet.locator('.in-load').tap(); await p.keyboard.type('95');
  await changedSet.locator('.in-reps').tap(); await p.keyboard.type('8');
  await field(0, '.in-load').tap(); await p.keyboard.type('135');
  await field(0, '.in-reps').tap(); await p.keyboard.type('10');
  await card(0).locator('.fill-sets').tap();
  await p.waitForTimeout(500);
  const preserved = await stored(id, '2026-09-01');
  t('fill blank sets keeps an adjusted set',
    JSON.stringify(preserved.map(set => [set.l, set.r]))===JSON.stringify([['135',10],['135',10],['95',8],['135',10]]),
    JSON.stringify(preserved));

  // 12. a second device update must not replace an unblurred edit
  await fresh(); id = await exId(1);
  const p2 = await ctx.newPage();
  await p2.goto(url); await p2.waitForTimeout(600);
  await field(1, '.in-load').tap(); await p.keyboard.type('137');
  await p2.evaluate(() => localStorage.setItem(`jt-lupe:jt:meal:${dateKey()}:remote`, JSON.stringify({
    name: 'Remote meal', calories: 400, protein: 30, carbs: 40, fat: 10
  })));
  await p.waitForTimeout(700);
  const raced = await p.evaluate(([exerciseId, value]) => ({
    value: document.querySelectorAll('.exercise')[1].querySelector('.in-load').value,
    stored: setsFor('jt', dateKey(), exerciseId).map(set => set.load),
    remote: localStorage.getItem(value) !== null
  }), [id, `jt-lupe:jt:meal:${await p.evaluate(() => dateKey())}:remote`]);
  t('remote update preserves an unblurred edit', raced.value === '137' && raced.stored[0] === '137', JSON.stringify(raced));
  await p2.close();

  // 13. HTML constraints must also hold at the storage boundary
  await fresh(); id = await exId(1);
  await p.evaluate(() => {
    const exerciseCard = document.querySelectorAll('.exercise')[1];
    const load = exerciseCard.querySelector('.in-load');
    const reps = exerciseCard.querySelector('.in-reps');
    load.value = '100'; load.dispatchEvent(new Event('input', { bubbles: true }));
    reps.value = '-3'; reps.dispatchEvent(new Event('input', { bubbles: true }));
    reps.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(450);
  let invalid = await p.evaluate(exerciseId => ({
    valid: document.querySelectorAll('.exercise')[1].querySelector('.in-reps').validity.valid,
    stored: setsFor('jt', dateKey(), exerciseId)
  }), id);
  t('negative reps are rejected before storage', !invalid.valid && invalid.stored.length === 0, JSON.stringify(invalid));

  await fresh(); id = await exId(1);
  await p.evaluate(() => {
    const exerciseCard = document.querySelectorAll('.exercise')[1];
    const load = exerciseCard.querySelector('.in-load');
    const reps = exerciseCard.querySelector('.in-reps');
    load.value = '100'; load.dispatchEvent(new Event('input', { bubbles: true }));
    reps.value = '1000'; reps.dispatchEvent(new Event('input', { bubbles: true }));
    reps.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(450);
  invalid = await p.evaluate(exerciseId => ({
    valid: document.querySelectorAll('.exercise')[1].querySelector('.in-reps').validity.valid,
    stored: setsFor('jt', dateKey(), exerciseId)
  }), id);
  t('over-limit reps are rejected before storage', !invalid.valid && invalid.stored.length === 0, JSON.stringify(invalid));

  t('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
  console.log(JSON.stringify({results:R}, null, 1));
  await b.close();
  // Non-zero on a failed check, not just on an exception. Without this the suite
  // exited 0 with FAIL lines in its output and the runner called it green.
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
