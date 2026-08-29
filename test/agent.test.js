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
    connectVisible: !document.querySelector('#agentConnectCard').hidden,
    workspaceHidden: document.querySelector('#agentWorkspace').hidden
  }));
  test('Coach is a wired fifth panel', surface.panels === 5 && surface.selected === 'true', JSON.stringify(surface));
  test('disconnected Coach shows OAuth setup', surface.status === 'Not connected' && surface.connectVisible && surface.workspaceHidden, JSON.stringify(surface));

  const status = await page.evaluate(async () => {
    const response = await fetch('./api/agent/status?ns=gym');
    return { status: response.status, body: await response.json() };
  });
  test('private agent status route responds', status.status === 200 && status.body.connected === false, JSON.stringify(status));
  test('free router delegates selection without forcing a fixed model',
    status.body.model === 'openrouter/free' && status.body.fallback === null, JSON.stringify(status.body));
  test('OpenRouter privacy routing is explicit',
    status.body.privacy?.dataCollection === 'deny' && status.body.privacy?.zeroDataRetention === false,
    JSON.stringify(status.body.privacy));

  const chat = await page.evaluate(async () => {
    const response = await fetch('./api/agent/chat?ns=gym', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'lupe', prompt: 'Review my training' })
    });
    return { status: response.status, body: await response.json() };
  });
  test('chat stays closed until OpenRouter is connected', chat.status === 409 && chat.body.error === 'openrouter_not_connected', JSON.stringify(chat));

  const invalidOAuth = await page.evaluate(async () => {
    const response = await fetch('./api/agent/connect?ns=gym', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x', verifier: 'short' })
    });
    return { status: response.status, body: await response.json() };
  });
  test('malformed OAuth response is rejected before exchange', invalidOAuth.status === 400 && invalidOAuth.body.error === 'invalid_oauth_response', JSON.stringify(invalidOAuth));

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
