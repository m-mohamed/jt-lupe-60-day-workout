import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const cloud = dirname(fileURLToPath(import.meta.url));
const root = resolve(cloud, '..');
const output = resolve(cloud, 'public');
const files = ['index.html', 'beautiful-ui.css', 'service-worker.js', 'manifest.webmanifest', 'icon.svg'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(root, file), resolve(output, file))));
await build({
  entryPoints: [resolve(cloud, 'src/onboarding-browser.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2022'],
  outfile: resolve(root, 'onboarding.js')
});
await copyFile(resolve(root, 'onboarding.js'), resolve(output, 'onboarding.js'));
console.log(`Prepared ${files.length + 1} Cloudflare assets in cloud/public.`);
