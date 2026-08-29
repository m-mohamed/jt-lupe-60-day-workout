const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');
const R = []; const t = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
const widths = [320, 390, 768, 1280];

(async () => {
  const browser = await chromium.launch(launchOptions());
  /* eslint-disable no-await-in-loop */
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 900, isMobile: width < 900 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:8911/');
    await page.waitForTimeout(600);

    for (const tab of ['train', 'fuel', 'supplements', 'agent', 'progress']) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(120);
      const audit = await page.evaluate(() => {
        const shown = node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        };
        const critical = [...document.querySelectorAll(
          '.session-now strong, .session-now span, .set-number, .insight-summary strong'
        )].filter(node => shown(node) && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight))
          .map(node => ({ text: node.textContent.trim().slice(0, 50), client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight] }));
        const outside = [...document.querySelectorAll('button, input:not(.visually-hidden), select, textarea')]
          .filter(shown).map(node => node.getBoundingClientRect())
          .filter(box => box.left < -1 || box.right > innerWidth + 1);
        return {
          bodyWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          critical,
          outside: outside.length,
          nav: getComputedStyle(document.querySelector('.sidebar-nav')).position,
          chatOverflow: (() => { const node = document.querySelector('#agentThread'); return node.scrollWidth > node.clientWidth; })()
        };
      });
      t(`${width}px/${tab}: no page or control overflow`, audit.bodyWidth <= audit.viewport + 1 && audit.outside === 0,
        JSON.stringify(audit));
      t(`${width}px/${tab}: essential copy is complete`, audit.critical.length === 0, JSON.stringify(audit.critical));
      if (tab === 'agent') t(`${width}px/agent: conversation has no horizontal scroll`, !audit.chatOverflow);
      if (width === 320 && tab === 'train') t('320px uses the thumb-reachable bottom navigation', audit.nav === 'fixed', audit.nav);
      if (width === 1280 && tab === 'train') t('desktop uses the Beautiful UI sidebar', audit.nav === 'sticky', audit.nav);
    }
    t(`${width}px: no page errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
  /* eslint-enable no-await-in-loop */

  console.log(JSON.stringify({ results: R }, null, 1));
  await browser.close();
  process.exit(R.some(result => result.startsWith('FAIL')) ? 1 : 0);
})().catch(error => { console.error('FAILED:', error.message); process.exit(1); });
