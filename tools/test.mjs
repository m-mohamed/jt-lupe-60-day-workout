// One command for the whole check. Starts both servers, runs every suite against the
// right one, tears everything down, and exits non-zero if anything failed.
//
// It exists because running these by hand meant remembering two ports, three wrangler
// flags and a NODE_PATH — and a suite run against the wrong server passes while
// testing nothing, which this project has been caught by twice.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const STATIC_PORT = 8911;
const WORKER_PORT = 8777;

// Suites are declared with the server they need, because that is the thing that goes
// wrong silently.
const SUITES = [
  { file: 'a11y.test.js', port: STATIC_PORT },
  { file: 'human-interaction.test.js', port: STATIC_PORT },
  { file: 'session-flow.test.js', port: STATIC_PORT },
  { file: 'import.test.js', port: STATIC_PORT },
  { file: 'migration.test.js', port: STATIC_PORT },
  { file: 'edge-cases.test.js', port: WORKER_PORT },
  { file: 'offline.test.js', port: WORKER_PORT },
  { file: 'upgrade.test.js', port: WORKER_PORT },
  { file: 'stress.test.js', port: WORKER_PORT }
];

const children = [];
const stop = () => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } } };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(130); });

const start = (label, command, args, cwd) => {
  const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore' });
  child.on('error', error => { console.error(`${label} failed to start: ${error.message}`); process.exit(1); });
  children.push(child);
  return child;
};

const waitFor = async (url, seconds) => {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // Drain the body. Leaving it unread while the socket closes crashes undici's
      // parser outright — it took CI down before a single suite had run.
      await response.arrayBuffer().catch(() => {});
      if (response.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise(s => setTimeout(s, 500));
  }
  return false;
};

const playwright = resolve(here, 'node_modules');
if (!existsSync(resolve(playwright, 'playwright-core'))) {
  console.error('playwright-core is missing. Run `npm install` in tools/ first.');
  process.exit(1);
}

console.log('starting servers…');
start('static server', 'python3', ['-m', 'http.server', String(STATIC_PORT), '--bind', '127.0.0.1'], repo);
// The dev-auth flags are not optional: wrangler dev otherwise reads the production
// Access config, 401s everything, and the worker-backed suites test local-only mode.
start('wrangler dev', 'npx', ['wrangler@4', 'dev', '--port', String(WORKER_PORT),
  '--persist-to', resolve(repo, '..', '.wrangler-state'),
  '--var', 'ACCESS_TEAM_DOMAIN:', '--var', 'ACCESS_AUD:', '--var', 'DEV_EMAIL:dev@local'], resolve(repo, 'cloud'));

if (!await waitFor(`http://127.0.0.1:${STATIC_PORT}/index.html`, 30)) { console.error('static server never came up'); process.exit(1); }
if (!await waitFor(`http://127.0.0.1:${WORKER_PORT}/api/me?ns=gym`, 90)) { console.error('wrangler dev never came up'); process.exit(1); }
console.log('servers up\n');

const run = (label, command, args, options = {}) => {
  const started = Date.now();
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', ...options });
    const passes = (output.match(/"PASS/g) || []).length || (output.match(/^PASS/gm) || []).length;
    // Do not trust the exit code alone. Four suites once exited 0 with FAIL lines in
    // their output, so a real failure read as green for as long as nobody looked.
    const failures = output.split('\n').filter(line => /(^|")FAIL/.test(line));
    if (failures.length) {
      console.log(`  FAIL  ${label}  (exited 0 while reporting failures)`);
      for (const line of failures) console.log(`        ${line.trim()}`);
      return { label, ok: false, passes: 0 };
    }
    console.log(`  ok    ${label.padEnd(28)} ${String(passes).padStart(3)} checks  ${Date.now() - started}ms`);
    return { label, ok: true, passes };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const failures = output.split('\n').filter(line => line.includes('FAIL'));
    console.log(`  FAIL  ${label}`);
    for (const line of failures.length ? failures : output.trim().split('\n').slice(-8)) console.log(`        ${line.trim()}`);
    return { label, ok: false, passes: 0 };
  }
};

const results = [];
results.push(run('lint', process.execPath, [resolve(here, 'lint.mjs')], { cwd: here }));
results.push(run('access (jwt)', process.execPath, ['access.test.mjs'], { cwd: resolve(repo, 'cloud') }));
for (const suite of SUITES) {
  results.push(run(suite.file.replace('.test.js', ''), process.execPath, [resolve(repo, 'test', suite.file)],
    { env: { ...process.env, NODE_PATH: playwright } }));
}

stop();
const failed = results.filter(r => !r.ok);
const checks = results.reduce((sum, r) => sum + r.passes, 0);
console.log(`\n${results.length - failed.length}/${results.length} suites, ${checks} checks`);
process.exit(failed.length ? 1 : 0);
