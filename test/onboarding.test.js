const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8911/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.trainingOnboardingReady === true);
  await page.evaluate(() => openOnboarding());

  const dialog = page.locator('#onboardingDialog');
  t('OnboardJS opens a focused Beautiful UI onboarding surface', await dialog.isVisible()
    && await dialog.getAttribute('data-onboarding-engine') === 'onboardjs'
    && await dialog.getAttribute('data-bui') === 'Approval Card');
  t('onboarding never uses the unwanted body-type label', !/skinny fat/i.test(await dialog.innerText()));

  await page.locator('#onboardWeight').fill('180');
  await page.locator('#onboardUnit').selectOption('lb');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#onboardDailySteps').fill('10000');
  await page.getByRole('button', { name: 'Continue' }).click();

  const targets = await page.evaluate(() => ({
    calories: document.querySelector('#onboardCalories').textContent,
    protein: document.querySelector('#onboardProtein').textContent,
    weeklySteps: document.querySelector('#onboardWeeklySteps').textContent
  }));
  t('starting targets follow the transcript arithmetic', targets.calories === '2,160 kcal'
    && targets.protein === '180 g' && targets.weeklySteps === '70,000', JSON.stringify(targets));

  await page.getByRole('button', { name: 'Save plan' }).click();
  const saved = await page.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('jt-lupe:jt:profile')),
    bodyweight: JSON.parse(localStorage.getItem(`jt-lupe:jt:bodyweight:${dateKey()}`)),
    dialog: document.querySelector('#onboardingDialog').open
  }));
  t('saving onboarding creates the synced plan and starting weigh-in', saved.profile?.dailySteps === 10000
    && saved.profile?.targets?.calories === 2160 && saved.bodyweight?.value === 180 && saved.dialog === false,
    JSON.stringify(saved));

  const surface = await page.evaluate(() => {
    setTab('fuel'); renderFuel();
    return {
      macroInputs: ['mealKcal', 'mealProtein', 'mealCarbs', 'mealFat'].every(id => document.getElementById(id)),
      stepInput: Boolean(document.getElementById('stepValue')),
      copy: document.querySelector('#panel-fuel').innerText
    };
  });
  t('Food exposes full macros and step logging without implementation copy', surface.macroInputs && surface.stepInput
    && !/OnboardJS|Beautiful UI|framework|primitive/i.test(surface.copy), JSON.stringify(surface));
  t('onboarding has no page errors', errors.length === 0, errors.join(' | '));

  console.log(JSON.stringify({ results: R }, null, 1));
  await browser.close();
  process.exit(R.some(result => result.startsWith('FAIL')) ? 1 : 0);
})().catch(error => { console.error('FAILED:', error.message); process.exit(1); });
