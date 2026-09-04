const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
(async () => {
  const b = await chromium.launch(launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[]; p.on('pageerror', e=>errors.push(String(e)));

  // seed v3 data, then load v4 and let it migrate
  await p.goto('http://127.0.0.1:8911/');
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jt-lupe-schema-version','3');
    // Monday week 1 = Aug 17. e2 was "Seated row", e5 "Hammer curl"
    localStorage.setItem('jt-lupe-load-w1-d0-e2-lupe','55');
    localStorage.setItem('jt-lupe-reps-w1-d0-e2-lupe','12');
    localStorage.setItem('jt-lupe-done-w1-d0-e2-lupe','true');
    localStorage.setItem('jt-lupe-load-w1-d0-e5-lupe','15');
    localStorage.setItem('jt-lupe-reps-w1-d0-e5-lupe','12');
    localStorage.setItem('jt-lupe-habit-lupe-2026-08-17-protein','true');
    localStorage.setItem('jt-lupe-weightlog-lupe-2026-08-17','198|lb');
    localStorage.setItem('jt-lupe-meal-lupe-2026-08-17-a', JSON.stringify({name:'Chicken',protein:40}));
  });
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2000);

  const mig = await p.evaluate(() => {
    const keys = Object.keys(localStorage);
    return {
      schema: localStorage.getItem('jt-lupe-schema-version'),
      oldGrid: keys.filter(k=>/^jt-lupe-(load|reps|done)-w/.test(k)).length,
      sets: keys.filter(k=>k.includes(':set:')),
      seatedRow: localStorage.getItem('jt-lupe:lupe:set:2026-08-17:seated-row:1'),
      habit: localStorage.getItem('jt-lupe:lupe:habit:2026-08-17:protein'),
      bw: localStorage.getItem('jt-lupe:lupe:bodyweight:2026-08-17'),
      meal: localStorage.getItem('jt-lupe:lupe:meal:2026-08-17:a')
    };
  });
  t('schema bumped to 5', mig.schema === '5', mig.schema);
  t('old grid keys removed', mig.oldGrid === 0, String(mig.oldGrid));
  t('sets written by date + slug', mig.sets.length === 2, JSON.stringify(mig.sets));
  t('seated row carried with load+reps', /"load":55/.test(mig.seatedRow) && /"reps":12/.test(mig.seatedRow), mig.seatedRow);
  t('migrated rows marked, set count NOT invented', /"migrated":true/.test(mig.seatedRow), mig.seatedRow);
  t('habit carried', /"done":true/.test(mig.habit||''), mig.habit);
  t('bodyweight carried', /"value":198/.test(mig.bw||''), mig.bw);
  t('meal carried', /Chicken/.test(mig.meal||''), mig.meal);

  // now log a fresh session with a real set count
  const fresh = await p.evaluate(() => {
    state.date = '2026-09-07'; state.profile='lupe'; renderSession();
    const card = document.querySelectorAll('.exercise')[0];   // Monday: incline press
    card.querySelectorAll('.set-row').forEach(row => {
      row.querySelector('.in-load').value = '140';
      row.querySelector('.in-reps').value = '10';
    });
    card.querySelector('.in-reps').dispatchEvent(new Event('change'));
    return Object.keys(localStorage).filter(k=>k.includes(':set:2026-09-07:')).toSorted();
  });
  t('FOUR sets stored for the four-set lead lift', fresh.length === 4, JSON.stringify(fresh));

  const coach = await p.evaluate(() => {
    renderSession();
    return document.querySelectorAll('.coach')[0].innerText;
  });
  t('coach reads all sets', /140×10, 140×10, 140×10, 140×10/.test(coach), coach);

  const nav = await p.evaluate(() => {
    state.date = '2026-09-08'; renderSession();
    document.getElementById('prevDay').click();
    return { title: document.getElementById('sessionTitle').innerText,
             flag: document.getElementById('backfillFlag').innerText,
             flagHidden: document.getElementById('backfillFlag').hidden,
             day: document.getElementById('challengeLine').innerText,
             today: dateKey() };
  });
  t('navigates to the official Day 1', /Monday/.test(nav.title) && /DAY 1 OF 60/i.test(nav.day), JSON.stringify(nav));
  const dayOneIsFuture = '2026-09-07' > nav.today;
  t('Day 1 is labelled planned before launch and backfilled after launch',
    (nav.today === '2026-09-07' && nav.flagHidden) || (/Monday/i.test(nav.flag) && (dayOneIsFuture
      ? /Planned for/i.test(nav.flag) && !/Catching up|Not today/i.test(nav.flag)
      : /Catching up|Not today/i.test(nav.flag))), nav.flag);

  const prog = await p.evaluate(() => { setTab('progress'); renderProgress();
    return { sets: document.getElementById('statLifts').textContent,
             rows: [...document.querySelectorAll('#strengthBody tbody tr')].map(r=>r.innerText.replace(/\n/g,' | ')) }; });
  t('progress counts set records', Number(prog.sets) >= 5, prog.sets);
  t('strength keeps migrated exercises visible after the plan changes', prog.rows.some(r=>/55×12/.test(r)), prog.rows[0]||'none');

  t('no page errors', errors.length===0, errors.slice(0,2).join(' | '));
  console.log(JSON.stringify({results:R, pageErrors:errors}, null, 1));
  await b.close();
  // Non-zero on a failed check, not just on an exception. Without this the suite
  // exited 0 with FAIL lines in its output and the runner called it green.
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
