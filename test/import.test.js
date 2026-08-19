const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R=[]; const t=(n,ok,d='')=>R.push(`${ok?'PASS':'FAIL'}  ${n}${d?`  -> ${d}`:''}`);
(async () => {
  const b = await chromium.launch(launchOptions());
  const p = await (await b.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[]; p.on('pageerror', e=>errors.push(String(e)));
  const q = require('fs').readFileSync('/tmp/prefill_v4.txt','utf8').trim()
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
    const keys = Object.keys(localStorage).filter(k=>k.includes(':set:2026-08-17:')).toSorted();
    return { keys, seated: keys.filter(k=>k.includes('seated-row')).length,
             pulldown: keys.filter(k=>k.includes('lat-pulldown')).length,
             carry: localStorage.getItem('jt-lupe:jt:set:2026-08-17:farmer-carry:1'),
             scap: localStorage.getItem('jt-lupe:jt:set:2026-08-17:scapular-pulls:1') };
  });
  t('Seated row stored as THREE sets', stored.seated === 3, String(stored.seated));
  t('Pulldown stored as TWO sets', stored.pulldown === 2, String(stored.pulldown));
  t('Farmer carry stored as seconds not reps', /"seconds":45/.test(stored.carry||'') && /"reps":null/.test(stored.carry||''), stored.carry);
  t('bodyweight row keeps BW, no invented reps', /"load":"BW"/.test(stored.scap||'') && /"reps":null/.test(stored.scap||''), stored.scap);
  t('total set records for Monday', stored.keys.length === 16, String(stored.keys.length));
  t('no page errors', errors.length===0, errors.slice(0,2).join(' | '));
  console.log(JSON.stringify({results:R}, null, 1));
  await b.close();
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
