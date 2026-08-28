// The interface contract is the Beautiful UI catalog. This test renders both the
// static application and the agent's runtime-only states, then proves that all
// twenty catalog primitives are present and legacy generic UI primitives are not.
const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');

const results = [];
const test = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
const expected = [
  'Loading State', 'Thinking', 'Streaming Text', 'Approval Card', 'Tool Chips',
  'Task Rows', 'Chat', 'Prompt Bar', 'Recommendation Card', 'Context Cards',
  'Diff Table', 'Records Table', 'Filter Table', 'Sidebar Nav', 'Search',
  'Flowchart', 'Insight Cards', 'Code Block', 'Fine-tune Card', 'Selection Actions'
];

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8911/');
  await page.evaluate(() => {
    setTab('agent');
    document.querySelector('#agentConnectCard').hidden = true;
    document.querySelector('#agentWorkspace').hidden = false;
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
  const missing = expected.filter(name => !audit.names.includes(name));
  test('all 20 Beautiful UI catalog primitives are mounted', missing.length === 0, JSON.stringify(missing));
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

  console.log(JSON.stringify({ results }, null, 1));
  await browser.close();
  process.exit(results.some(result => result.startsWith('FAIL')) ? 1 : 0);
})();
