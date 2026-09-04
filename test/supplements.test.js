const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8911/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://127.0.0.1:8911/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await page.locator('.tab[data-tab="supplements"]').tap();
  await page.waitForTimeout(250);
  t('supplements is a first-class tracker tab', await page.locator('#panel-supplements').isVisible());

  await page.locator('[data-supplement-preset="protein"]').tap();
  let preset = await page.evaluate(() => ({ name: document.getElementById('supplementName').value,
    dose: document.getElementById('supplementDose').value,
    unit: document.getElementById('supplementUnit').value }));
  t('protein preset uses the exact product and leaves dose label-driven',
    preset.name === 'Optimum Nutrition Extreme Milk Chocolate' && preset.dose === '' && preset.unit === 'serving', JSON.stringify(preset));
  await page.locator('#supplementDose').tap(); await page.keyboard.type('1');
  await page.locator('#addSupplement').tap();
  await page.waitForTimeout(300);
  let rows = await page.evaluate(() => readSupplements('jt', dateKey()));
  t('protein intake keeps the entered serving amount', rows.length === 1 && rows[0].name === 'Optimum Nutrition Extreme Milk Chocolate' && rows[0].dose === 1 && rows[0].unit === 'serving', JSON.stringify(rows));

  await page.locator('[data-supplement-preset="creatine"]').tap();
  preset = await page.evaluate(() => ({ name: document.getElementById('supplementName').value,
    dose: document.getElementById('supplementDose').value,
    unit: document.getElementById('supplementUnit').value }));
  t('creatine preset uses the exact product and leaves pill count label-driven',
    preset.name === 'Optimum Nutrition Creatine Pills' && preset.dose === '' && preset.unit === 'capsule', JSON.stringify(preset));
  await page.locator('#supplementDose').tap(); await page.keyboard.type('4');
  await page.locator('#addSupplement').tap();
  await page.waitForTimeout(300);
  rows = await page.evaluate(() => readSupplements('jt', dateKey()));
  t('creatine intake keeps the entered pill amount', rows.some(row => row.name === 'Optimum Nutrition Creatine Pills' && row.dose === 4 && row.unit === 'capsule'), JSON.stringify(rows));

  await page.locator('#supplementName').tap(); await page.keyboard.type('Magnesium glycinate');
  await page.locator('#supplementDose').tap(); await page.keyboard.type('200');
  await page.locator('#supplementUnit').selectOption('mg');
  await page.locator('#addSupplement').tap();
  await page.waitForTimeout(300);
  rows = await page.evaluate(() => readSupplements('jt', dateKey()));
  t('custom supplement keeps its name, dose, and unit',
    rows.some(row => row.name === 'Magnesium glycinate' && row.dose === 200 && row.unit === 'mg'), JSON.stringify(rows));

  const summary = await page.evaluate(() => ({ today: document.getElementById('supplementToday').textContent,
    history: document.getElementById('supplementHistory').innerText }));
  t('daily count updates', summary.today === '3', JSON.stringify(summary));
  t('history shows the recorded intake', /Optimum Nutrition Extreme Milk Chocolate 1 serving/.test(summary.history)
    && /Optimum Nutrition Creatine Pills 4 capsule/.test(summary.history)
    && /Magnesium glycinate 200 mg/.test(summary.history), summary.history);

  await page.locator('[data-supplement-key]').first().tap();
  await page.waitForTimeout(300);
  rows = await page.evaluate(() => readSupplements('jt', dateKey()));
  t('undo removes one intake without touching the other', rows.length === 2
    && rows.some(row => row.name === 'Optimum Nutrition Creatine Pills')
    && rows.some(row => row.name === 'Magnesium glycinate')
    && !rows.some(row => row.name === 'Optimum Nutrition Extreme Milk Chocolate'), JSON.stringify(rows));

  t('no page errors', errors.length === 0, errors.join(' | '));
  console.log(JSON.stringify({ results: R }, null, 1));
  await browser.close();
  process.exit(R.some(result => result.startsWith('FAIL')) ? 1 : 0);
})().catch(error => { console.error('FAILED:', error.message); process.exit(1); });
