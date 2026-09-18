import fs from 'node:fs';
import path from 'node:path';
import { ROOT, assertPackageParity } from './package-utils.mjs';

const version = assertPackageParity();
const dist = path.join(ROOT, 'dist');

if (!fs.existsSync(dist)) {
  throw new Error('dist/ is missing. Run the production build before PWA cache certification.');
}

const serviceWorkerCandidates = fs
  .readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /(?:^sw\.js$|service-worker.*\.js$|workbox.*\.js$)/i.test(entry.name))
  .map((entry) => path.join(dist, entry.name));

if (!serviceWorkerCandidates.length) {
  throw new Error(
    'No built PWA service worker/workbox artifact found. 6.2A requires Scandit runtime cache integration.',
  );
}

const combined = serviceWorkerCandidates
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const expectedPrefix = `/scandit/${version}/sdc-lib/`;
const expectedManifest = `/scandit/${version}/runtime-manifest.json`;

if (!combined.includes(expectedPrefix)) {
  throw new Error(
    `Built service worker does not reference certified Scandit runtime path ${expectedPrefix}`,
  );
}
if (!combined.includes(expectedManifest)) {
  throw new Error(
    `Built service worker does not precache/reference Scandit runtime manifest ${expectedManifest}`,
  );
}

const runtimeManifestPath = path.join(
  ROOT,
  'public',
  'scandit',
  version,
  'runtime-manifest.json',
);
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
const wasm = runtimeManifest.files.find((item) => item.path.endsWith('.wasm'));
const js = runtimeManifest.files.find((item) => item.path.endsWith('.js'));

for (const item of [wasm, js].filter(Boolean)) {
  const url = `${expectedPrefix}${item.path}`;
  if (!combined.includes(url)) {
    throw new Error(`Built service worker does not include representative runtime asset ${url}`);
  }
}

console.log(`PASS PWA cache includes certified Scandit ${version} JS/WASM runtime and manifest.`);
