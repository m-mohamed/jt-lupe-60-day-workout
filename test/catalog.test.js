// The interface contract is the Beautiful UI catalog. This test renders both the
// static application and the agent's runtime-only states, then proves that every
// mounted primitive belongs to the catalog and every product-needed primitive is
// present. Catalog demos with no user job are intentionally not mounted.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');

const results = [];
const test = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
const catalog = [
  'Loading State', 'Thinking', 'Streaming Text', 'Approval Card', 'Tool Chips',
  'Task Rows', 'Chat', 'Prompt Bar', 'Recommendation Card', 'Context Cards',
  'Diff Table', 'Records Table', 'Filter Table', 'Sidebar Nav', 'Search',
  'Flowchart', 'Insight Cards', 'Code Block', 'Fine-tune Card', 'Selection Actions'
];
const required = catalog.filter(name => !['Recommendation Card', 'Flowchart'].includes(name));

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8911/');
  const productSurface = await page.evaluate(() => {
    setTab('agent');
    return {
      text: document.querySelector('#panel-agent').innerText,
      suggestions: document.querySelectorAll('[data-agent-prompt]').length,
      resetHidden: document.querySelector('#agentReset').hidden
    };
  });
  test('Coach surface contains no implementation or catalog-showcase copy',
    !/Pi agent|OpenRouter|Agent run|Active context|Control path|Health MCP/i.test(productSurface.text),
    productSurface.text);
  test('empty Coach surface has no redundant starter or reset buttons',
    productSurface.suggestions === 0 && productSurface.resetHidden === true, JSON.stringify(productSurface));
  await page.evaluate(() => {
    appendAgentMessage('assistant', 'Catalog audit');
    appendAgentLoading();
    appendAgentTool('get_training_snapshot');
    appendAgentProposal({ kind: 'meal', date: '2026-08-28', name: 'Audit meal', protein: 30, kcal: 440, estimate: true });
  });

  const audit = await page.evaluate(() => {
    const names = [...document.querySelectorAll('[data-bui]')].map(node => node.dataset.bui);
    const forbidden = new Set(['card', 'chip', 'pill', 'badge', 'btn', 'fab']);
    const legacy = [...document.querySelectorAll('[class]')].flatMap(node =>
      [...node.classList].filter(name => forbidden.has(name.toLowerCase())));
    return {
      names: [...new Set(names)].toSorted(),
      legacy: [...new Set(legacy)],
      timerPosition: getComputedStyle(document.querySelector('#timerFab')).position
    };
  });
  const missing = required.filter(name => !audit.names.includes(name));
  const unknown = audit.names.filter(name => !catalog.includes(name));
  test('every product-needed Beautiful UI primitive is mounted', missing.length === 0, JSON.stringify(missing));
  test('every mounted interface primitive belongs to the Beautiful UI catalog', unknown.length === 0, JSON.stringify(unknown));
  test('legacy generic component classes are absent', audit.legacy.length === 0, JSON.stringify(audit.legacy));
  test('workout Tool Chip stays in document flow', audit.timerPosition !== 'fixed', audit.timerPosition);
  test('catalog runtime states have no page errors', errors.length === 0, errors.join(' | '));

  await page.setViewportSize({ width: 1280, height: 800 });
  const layout = await page.evaluate(() => {
    const chat = document.querySelector('#agentThread').getBoundingClientRect();
    const composer = document.querySelector('#agentForm').getBoundingClientRect();
    return { chatBottom: chat.bottom, composerTop: composer.top };
  });
  test('desktop Prompt Bar follows Chat without overlap', layout.composerTop >= layout.chatBottom,
    JSON.stringify(layout));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('.agent-loader-grid span').first().evaluate(node => ({
    duration: getComputedStyle(node).animationDuration,
    iterations: getComputedStyle(node).animationIterationCount
  }));
  test('catalog motion respects the device reduced-motion setting',
    Number.parseFloat(motion.duration) <= 0.001 && motion.iterations === '1', JSON.stringify(motion));

  console.log(JSON.stringify({ results }, null, 1));
  await browser.close();
  process.exit(results.some(result => result.startsWith('FAIL')) ? 1 : 0);
})();
