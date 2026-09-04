const { chromium } = require('playwright-core');
const { launchOptions } = require('./browser.js');

const R = [];
const test = (name, ok, detail = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
const url = 'http://127.0.0.1:8777/';

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => syncState.enabled === true);
  await page.evaluate(() => setTab('agent'));
  await page.waitForFunction(() => document.querySelector('#agentConnection')?.textContent !== 'Checking');

  const surface = await page.evaluate(() => ({
    panels: document.querySelectorAll('[role="tabpanel"]').length,
    selected: document.querySelector('[data-tab="agent"]').getAttribute('aria-selected'),
    status: document.querySelector('#agentConnection').textContent,
    connectControlPresent: Boolean(document.querySelector('#agentConnectCard, #agentConnect')),
    workspaceHidden: document.querySelector('#agentWorkspace').hidden,
    sendDisabled: document.querySelector('#agentSend').disabled,
    suggestionButtons: document.querySelectorAll('[data-agent-prompt]').length
  }));
  test('Coach is a wired fifth panel', surface.panels === 5 && surface.selected === 'true', JSON.stringify(surface));
  test('Coach never asks either user to connect a model account',
    surface.status === 'Unavailable' && !surface.connectControlPresent && !surface.workspaceHidden
      && surface.sendDisabled && surface.suggestionButtons === 0,
    JSON.stringify(surface));

  const status = await page.evaluate(async () => {
    const response = await fetch('./api/agent/status?ns=gym');
    return { status: response.status, body: await response.json() };
  });
  test('private agent status route reports workspace configuration without a user connection step',
    status.status === 200 && status.body.connected === false && status.body.requiresUserConnection === false,
    JSON.stringify(status));
  test('free router delegates selection without forcing a fixed model',
    status.body.model === 'openrouter/free' && status.body.fallback === null, JSON.stringify(status.body));
  test('status advertises every approval-only record action',
    JSON.stringify(status.body.capabilities?.proposalTypes) === JSON.stringify(['set', 'meal', 'supplement', 'bodyweight', 'habit', 'steps', 'profile', 'removal']),
    JSON.stringify(status.body.capabilities));
  test('status advertises safe UI-driving actions separately from record writes',
    JSON.stringify(status.body.capabilities?.uiActionTypes) === JSON.stringify(['navigate', 'interface']),
    JSON.stringify(status.body.capabilities));
  test('status advertises the same food catalog available in the direct UI',
    status.body.capabilities?.readTools?.includes('food_catalog') === true,
    JSON.stringify(status.body.capabilities));
  test('OpenRouter privacy routing is explicit',
    status.body.privacy?.dataCollection === 'allow' && status.body.privacy?.zeroDataRetention === false,
    JSON.stringify(status.body.privacy));

  const chat = await page.evaluate(async () => {
    const response = await fetch('./api/agent/chat?ns=gym', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'lupe', prompt: 'Review my training' })
    });
    return { status: response.status, body: await response.json() };
  });
  test('missing workspace configuration is an unavailable service, not an account prompt',
    chat.status === 503 && chat.body.error === 'coach_unavailable', JSON.stringify(chat));

  const removedOAuth = await page.evaluate(async () => {
    const response = await fetch('./api/agent/connect?ns=gym', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x', verifier: 'short' })
    });
    return { status: response.status, body: await response.json() };
  });
  test('legacy personal OpenRouter connection endpoint is removed',
    removedOAuth.status === 404 && removedOAuth.body.error === 'not_found', JSON.stringify(removedOAuth));

  const oversized = await page.evaluate(async () => {
    const response = await fetch('./api/agent/chat?ns=gym', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'lupe', prompt: 'x'.repeat(128 * 1024) })
    });
    return { status: response.status, body: await response.json() };
  });
  test('oversized agent body is rejected before parsing', oversized.status === 413 && oversized.body.error === 'payload_too_large',
    JSON.stringify(oversized));
  test('Coach surface has no page errors', errors.length === 0, errors.join(' | '));

  console.log(JSON.stringify({ results: R }, null, 1));
  await browser.close();
  process.exit(R.some(result => result.startsWith('FAIL')) ? 1 : 0);
})();
