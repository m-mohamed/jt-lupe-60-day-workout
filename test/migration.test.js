const { chromium } = require('playwright-core');
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
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
  t('schema bumped to 4', mig.schema === '4', mig.schema);
  t('old grid keys removed', mig.oldGrid === 0, String(mig.oldGrid));
  t('sets written by date + slug', mig.sets.length === 2, JSON.stringify(mig.sets));
  t('seated row carried with load+reps', /"load":55/.test(mig.seatedRow) && /"reps":12/.test(mig.seatedRow), mig.seatedRow);
  t('migrated rows marked, set count NOT invented', /"migrated":true/.test(mig.seatedRow), mig.seatedRow);
  t('habit carried', /"done":true/.test(mig.habit||''), mig.habit);
  t('bodyweight carried', /"value":198/.test(mig.bw||''), mig.bw);
  t('meal carried', /Chicken/.test(mig.meal||''), mig.meal);

  // now log a fresh session with a real set count
  const fresh = await p.evaluate(() => {
    state.date = '2026-08-18'; state.profile='lupe'; renderSession();
    const card = document.querySelectorAll('.exercise')[1];   // Tuesday: leg press
    card.querySelector('.in-load').value = '140';
    card.querySelector('.in-reps').value = '10';
    card.querySelector('.in-sets').value = '3';
    card.querySelector('.in-sets').dispatchEvent(new Event('change'));
    return Object.keys(localStorage).filter(k=>k.includes(':set:2026-08-18:')).sort();
  });
  t('THREE sets stored for "3 sets of 10"', fresh.length === 3, JSON.stringify(fresh));

  const coach = await p.evaluate(() => {
    renderSession();
    return document.querySelectorAll('.coach')[1].innerText;
  });
  t('coach reads all sets', /3 × 10 at 140/.test(coach), coach);

  const nav = await p.evaluate(() => {
    document.getElementById('prevDay').click();
    return { title: document.getElementById('sessionTitle').innerText,
             flag: document.getElementById('backfillFlag').innerText,
             day: document.getElementById('challengeLine').innerText };
  });
  t('navigates by date', /Monday/.test(nav.title) && /DAY 1 OF 60/i.test(nav.day), JSON.stringify(nav));
  t('backfill flag names the date', /Yesterday/.test(nav.flag), nav.flag);

  const prog = await p.evaluate(() => { setTab('progress'); renderProgress();
    return { sets: document.getElementById('statLifts').textContent,
             rows: [...document.querySelectorAll('#strengthBody tbody tr')].map(r=>r.innerText.replace(/\n/g,' | ')) }; });
  t('progress counts set records', Number(prog.sets) >= 5, prog.sets);
  t('strength shows sets x reps at load', prog.rows.some(r=>/at 55/.test(r)), prog.rows[0]||'none');

  t('no page errors', errors.length===0, errors.slice(0,2).join(' | '));
  console.log(JSON.stringify({results:R, pageErrors:errors}, null, 1));
  await b.close();
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
