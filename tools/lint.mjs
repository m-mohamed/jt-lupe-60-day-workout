// The app is one HTML file, and oxlint reads JavaScript. So: stage the sources in a
// temporary directory, lint that, then translate the line numbers in the output back
// to index.html so a finding is still one click from the code it is about.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
// Staged outside the repository. Inside it, the directory would have to be
// gitignored, and oxlint honours .gitignore - which silently linted nothing and
// still exited green, which is the exact failure mode this repo has been bitten by.
const work = mkdtempSync(resolve(tmpdir(), 'jt-lupe-lint-'));

const html = readFileSync(resolve(repo, 'index.html'), 'utf8').split('\n');
// Every <script> block in the page, with the line it starts on, so findings can be
// reported against index.html rather than against a temporary file.
const blocks = [];
for (let i = 0; i < html.length; i += 1) {
  if (!/^\s*<script>\s*$/.test(html[i])) continue;
  const end = html.findIndex((line, n) => n > i && /^\s*<\/script>\s*$/.test(line));
  if (end === -1) continue;
  blocks.push({ name: `inline-${blocks.length + 1}.js`, offset: i + 1, body: html.slice(i + 1, end) });
  i = end;
}
for (const block of blocks) writeFileSync(resolve(work, block.name), block.body.join('\n'));

cpSync(resolve(repo, 'cloud/src'), resolve(work, 'worker'), { recursive: true });
cpSync(resolve(repo, 'test'), resolve(work, 'test'), { recursive: true, filter: src => !src.endsWith('.md') });

let output = '';
let failed = false;
try {
  output = execFileSync(resolve(here, 'node_modules/.bin/oxlint'), [work, '-c', resolve(here, 'oxlint.config.mjs')], { cwd: here, encoding: 'utf8' });
} catch (error) {
  failed = true;
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
}

for (const block of blocks) {
  const pattern = new RegExp(`\\S*${block.name}:(\\d+):`, 'g');
  output = output.replace(pattern, (_, line) => `index.html:${Number(line) + block.offset}:`);
}
output = output.replaceAll(`${work}/worker/`, 'cloud/src/').replaceAll(`${work}/test/`, 'test/');
process.stdout.write(output);
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
