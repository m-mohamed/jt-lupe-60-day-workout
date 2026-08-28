import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cloud = dirname(fileURLToPath(import.meta.url));
const root = resolve(cloud, '..');
const output = resolve(cloud, 'public');
const files = ['index.html', 'beautiful-ui.css', 'service-worker.js', 'manifest.webmanifest', 'icon.svg'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(root, file), resolve(output, file))));
console.log(`Prepared ${files.length} Cloudflare assets in cloud/public.`);
