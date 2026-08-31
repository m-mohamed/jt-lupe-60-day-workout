const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const settle = p => p.waitForFunction(()=>['synced','local','offline','error'].includes(document.getElementById('syncChip').dataset.state), null, {timeout:25000});
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
(async () => {
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({viewport:{width:390,height:844}});
  const p = await ctx.newPage();
  const errors=[]; p.on('pageerror', e=>errors.push(String(e)));
  await p.goto('http://127.0.0.1:8777/'); await settle(p);

  // Fail loudly rather than silently testing the local-only path. `wrangler dev`
  // picks up the production Access vars from wrangler.jsonc, which makes every
  // request 401 and quietly drops this suite into offline mode - where two thirds
  // of what it checks does not exist. See README.md for the flags that turn it off.
  const me = await p.evaluate(() => fetch('./api/me?ns=gym').then(r => r.json()).catch(() => null));
  if (!me || !me.email) {
    console.error('Not signed in to the dev worker - this suite would test nothing. Got:', JSON.stringify(me));
    console.error('Start it with: npx wrangler@4 dev --port 8777 --var ACCESS_TEAM_DOMAIN: --var ACCESS_AUD: --var DEV_EMAIL:dev@local');
    await b.close(); process.exit(2);
  }

  // XSS via meal name
  let r = await p.evaluate(async () => {
    setTab('fuel'); state.fuelDate = dateKey(); renderFuel();
    document.getElementById('mealName').value = '<img src=x onerror="window.pwnedByMealName=1">';
    document.getElementById('mealProtein').value = '10';
    document.getElementById('addMeal').click();
    await new Promise(s=>setTimeout(s,400));
    return { pwned: !!window.pwnedByMealName, imgs: document.querySelectorAll('#mealList img').length };
  });
  t('XSS in meal name escaped', !r.pwned && r.imgs===0, JSON.stringify(r));

  // XSS via load value rendered into an input
  r = await p.evaluate(() => {
    state.date = '2026-09-01';
    renderSession();
    writeSet(state.profile, state.date, dayForDate(state.date).exercises[1].id, 1, { load:'" onfocus="window.pwnedByLoad=1', unit:'lb', reps:5, seconds:null, rir:null });
    setTab('train'); renderSession();
    return { pwned: !!window.pwnedByLoad, v: document.querySelectorAll('.exercise')[1].querySelector('.in-load').value };
  });
  t('quote injection in load escaped', !r.pwned, JSON.stringify(r));

  // corrupt record must not crash
  r = await p.evaluate(() => {
    localStorage.setItem(K.set(state.profile, state.date, 'leg-press', 9), '{not json');
    try { renderSession(); return {ok:true}; } catch(e){ return {ok:false, e:String(e)}; }
  });
  t('corrupt set record does not crash', r.ok, JSON.stringify(r));

  // future date refused on fuel
  r = await p.evaluate(async () => {
    setTab('fuel');
    const el2=document.getElementById('fuelDate'); el2.value='2027-12-31'; el2.dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,200));
    return { v: el2.value, today: dateKey() };
  });
  t('future date snaps back to today', r.v===r.today, JSON.stringify(r));

  // blank meal rejected
  r = await p.evaluate(async () => {
    const before=document.querySelectorAll('#mealList li').length;
    document.getElementById('mealName').value='   '; document.getElementById('addMeal').click();
    await new Promise(s=>setTimeout(s,300));
    return { before, after: document.querySelectorAll('#mealList li').length };
  });
  t('blank meal rejected', r.before===r.after, JSON.stringify(r));

  // negative bodyweight ignored
  r = await p.evaluate(async () => {
    const before = localStorage.getItem(K.bodyweight(state.profile, dateKey()));
    document.getElementById('bwValue').value='-50';
    document.getElementById('bwValue').dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,300));
    return { same: before === localStorage.getItem(K.bodyweight(state.profile, dateKey())) };
  });
  t('negative bodyweight ignored', r.same);

  // profile isolation
  r = await p.evaluate(() => {
    writeSet('lupe','2026-09-01','leg-press',1,{load:111,unit:'lb',reps:5,seconds:null,rir:null});
    writeSet('jt',  '2026-09-01','leg-press',1,{load:222,unit:'lb',reps:5,seconds:null,rir:null});
    return { lupe: setsFor('lupe','2026-09-01','leg-press')[0].load,
             jt:   setsFor('jt','2026-09-01','leg-press')[0].load };
  });
  t('profiles isolated', r.lupe===111 && r.jt===222, JSON.stringify(r));

  // Bodyweight work must not receive a machine-style weight jump.
  r = await p.evaluate(() => {
    setTab('train'); state.date='2026-08-31'; renderSession();
    return { bodyweight: [...document.querySelectorAll('.coach')].at(-1).innerText };
  });
  t('bodyweight work uses a variation, not a numeric jump', !/Go up to \d|start at \d/i.test(r.bodyweight), r.bodyweight.slice(0,80));

  // Whole Foods Hot Bar must be reliable even when USDA has no matching menu rows.
  r = await p.evaluate(() => fetch('./api/food?q=Whole%20Foods%20Hot%20Bar%20chicken').then(response => response.json()));
  t('Whole Foods Hot Bar search returns built-in estimates',
    r.estimated === true && r.foods.length > 0 && r.foods.every(food => /Whole Foods Hot Bar/i.test(food.name)), JSON.stringify(r));
  t('Whole Foods Hot Bar results disclose that they are estimates',
    r.foods.every(food => /estimate/i.test(`${food.name} ${food.brand} ${food.kind}`)), JSON.stringify(r.foods));

  // offline -> reconnect
  await ctx.setOffline(true);
  await p.evaluate(()=>{ window.dispatchEvent(new Event('offline'));
    writeSet(state.profile,'2026-09-02','leg-press',1,{load:999,unit:'lb',reps:3,seconds:null,rir:null}); });
  await p.waitForTimeout(1500);
  const off = await p.evaluate(()=>({chip:document.getElementById('syncChip').dataset.state, dirty:readDirty().length}));
  await ctx.setOffline(false);
  await p.evaluate(()=>window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(5000); await settle(p); await p.waitForTimeout(2500);
  const on = await p.evaluate(async()=>{ const s=await (await fetch('./api/export?ns=gym')).json();
    return { dirty: readDirty().length, has: !!s.data[`jt-lupe:${state.profile}:set:2026-09-02:leg-press:1`] }; });
  t('offline write queues', off.dirty>0, JSON.stringify(off));
  t('queue flushes on reconnect', on.has && on.dirty===0, JSON.stringify(on));

  // deleting the last set must upload a tombstone, otherwise another device can
  // resurrect the record from the server on its next pull
  await p.evaluate(() => {
    state.date = '2026-09-04'; setTab('train'); renderSession();
    writeSet(state.profile, state.date, 'leg-press', 1, { load: '88', unit: 'lb', reps: 8, seconds: null, rir: 2 });
    scheduleSync();
  });
  await p.waitForTimeout(3500);
  const beforeDelete = await p.evaluate(async () => (await fetch('./api/export?ns=gym')).json());
  await p.evaluate(() => { clearSets(state.profile, '2026-09-04', 'leg-press'); renderSession(); });
  await p.waitForTimeout(3500);
  const afterDelete = await p.evaluate(async () => (await fetch('./api/export?ns=gym')).json());
  const deleteDirty = await p.evaluate(() => readDirty().length);
  t('set deletion syncs a tombstone',
    !!beforeDelete.data['jt-lupe:jt:set:2026-09-04:leg-press:1']
      && !afterDelete.data['jt-lupe:jt:set:2026-09-04:leg-press:1']
      && deleteDirty === 0,
    JSON.stringify({ before: !!beforeDelete.data['jt-lupe:jt:set:2026-09-04:leg-press:1'], after: !!afterDelete.data['jt-lupe:jt:set:2026-09-04:leg-press:1'], dirty: deleteDirty }));

  // second device converges
  const ctx2 = await b.newContext({viewport:{width:390,height:844}});
  const p2 = await ctx2.newPage();
  await p2.goto('http://127.0.0.1:8777/'); await settle(p2); await p2.waitForTimeout(2500);
  r = await p2.evaluate(()=>{ const s=setsFor(state.profile,'2026-09-02','leg-press'); return s.length?s[0].load:null; });
  t('second device sees the write', r===999, String(r));

  // backup -> wipe -> restore
  r = await p.evaluate(() => {
    const data={}; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k.startsWith('jt-lupe')) data[k]=localStorage.getItem(k);}
    const before=Object.keys(data).length; localStorage.clear();
    Object.entries(data).forEach(([k,v])=>localStorage.setItem(k,v));
    return { before, after: Object.keys(localStorage).filter(k=>k.startsWith('jt-lupe')).length };
  });
  t('backup -> wipe -> restore round-trips', r.before===r.after, JSON.stringify(r));

  t('no page errors', errors.length===0, errors.slice(0,2).join(' | '));
  console.log(JSON.stringify({results:R}, null, 1));
  await ctx2.close();
  await b.close();
  // Non-zero on a failed check, not just on an exception. Without this the suite
  // exited 0 with FAIL lines in its output and the runner called it green.
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
