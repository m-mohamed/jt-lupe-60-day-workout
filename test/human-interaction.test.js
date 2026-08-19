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
    await p.evaluate(()=>{ state.date='2026-08-18'; state.profile='jt'; renderSession(); }); };
  const stored = ex => p.evaluate(id=>setsFor('jt','2026-08-18',id).map(s=>({l:s.load,r:s.reps})), ex);
  const exId = i => p.evaluate(n=>document.querySelectorAll('.in-load')[n].dataset.ex, i);

  // 1. real typing + tap the NEXT field
  await fresh();
  let id = await exId(1);
  await p.locator('.in-load').nth(1).tap();
  await p.keyboard.type('140');
  await p.locator('.in-reps').nth(1).tap();
  await p.keyboard.type('10');
  await p.locator('.in-load').nth(2).tap();          // move focus away for real
  await p.waitForTimeout(500);
  t('type with a real keyboard, tap the next field', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 2. type then SWITCH TABS without blurring
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap();
  await p.keyboard.type('155');
  await p.locator('.tab[data-tab="fuel"]').tap();
  await p.waitForTimeout(600);
  t('type then switch tab', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 3. type then step to another DAY without blurring
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap();
  await p.keyboard.type('165');
  await p.locator('#prevDay').tap();
  await p.waitForTimeout(600);
  t('type then step to another day', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 4. type then RELOAD without blurring
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap();
  await p.keyboard.type('175');
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  t('type then reload the page', (await stored(id)).length>0, JSON.stringify(await stored(id)));

  // 5. decimal weight
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap(); await p.keyboard.type('52.5');
  await p.locator('.in-reps').nth(1).tap(); await p.keyboard.type('8');
  await p.locator('.in-load').nth(2).tap(); await p.waitForTimeout(400);
  t('decimal weight 52.5 survives', JSON.stringify(await stored(id)).includes('52.5'), JSON.stringify(await stored(id)));

  // 6. comma decimal (European keyboards / some locales)
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap(); await p.keyboard.type('52,5');
  await p.locator('.in-load').nth(2).tap(); await p.waitForTimeout(400);
  const commaRead = await p.evaluate(()=>numericLoad('52,5'));
  t('comma decimal read as 52.5 not 525', commaRead === 52.5, String(commaRead));

  // 7. rapid double-tap on done
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap(); await p.keyboard.type('100');
  await p.locator('.in-reps').nth(1).tap(); await p.keyboard.type('8');
  await p.locator('.in-done').nth(1).tap();
  await p.locator('.in-done').nth(1).tap();
  await p.waitForTimeout(500);
  const after = await stored(id);
  t('double-tapping done does not duplicate or orphan', after.length===0 || after.length===3, JSON.stringify(after));

  // 8. paste instead of typing
  await fresh(); id = await exId(1);
  await p.locator('.in-load').nth(1).tap();
  await p.evaluate(() => {
    const i=document.querySelectorAll('.in-load')[1];
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

  t('no page errors', errors.length===0, errors.slice(0,3).join(' | '));
  console.log(JSON.stringify({results:R}, null, 1));
  await b.close();
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
