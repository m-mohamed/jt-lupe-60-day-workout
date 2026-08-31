const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
(async () => {
  const b = await chromium.launch(launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[]; p.on('pageerror', e=>errors.push(String(e)));
  const q = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'prefill-day1.txt'), 'utf8').trim()
    .replace('https://jt-lupe-workout.jt-lupe-workout-cloud.workers.dev/','http://127.0.0.1:8911/');
  await p.goto('http://127.0.0.1:8911/');
  await p.evaluate(()=>localStorage.clear());
  await p.goto(q, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2000);

  const st = await p.evaluate(()=>({
    session: document.getElementById('sessionTitle').innerText,
    day: document.getElementById('challengeLine').innerText,
    rows: [...document.querySelectorAll('.import-row')].map(r=>r.innerText.replace(/\n/g,' | ')),
    summary: document.querySelector('#importResult p')?.innerText || ''
  }));
  t('link lands on Monday, Day 1', /Monday/.test(st.session) && /DAY 1/i.test(st.day), st.session+' / '+st.day);
  t('all 7 matched', /7 of 7/.test(st.summary), st.summary);

  const stored = await p.evaluate(()=>{
    document.getElementById('importApply').click();
    const keys = Object.keys(localStorage).filter(k=>k.includes(':set:2026-08-31:')).toSorted();
    return { keys, incline: keys.filter(k=>k.includes('dumbbell-incline-press')).length,
             legPress: keys.filter(k=>k.includes('leg-press')).length,
             core: localStorage.getItem('jt-lupe:jt:set:2026-08-31:hanging-knee-raise:1') };
  });
  t('Incline press stored as FOUR sets', stored.incline === 4, String(stored.incline));
  t('Leg press stored as THREE sets', stored.legPress === 3, String(stored.legPress));
  t('bodyweight row keeps BW and its reps', /"load":"BW"/.test(stored.core||'') && /"reps":12/.test(stored.core||''), stored.core);
  t('total set records for Monday', stored.keys.length === 21, String(stored.keys.length));
  t('no page errors', errors.length===0, errors.slice(0,2).join(' | '));
  console.log(JSON.stringify({results:R}, null, 1));
  await b.close();
  // Non-zero on a failed check, not just on an exception. Without this the suite
  // exited 0 with FAIL lines in its output and the runner called it green.
  process.exit(R.some(x => x.startsWith('FAIL')) ? 1 : 0);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
