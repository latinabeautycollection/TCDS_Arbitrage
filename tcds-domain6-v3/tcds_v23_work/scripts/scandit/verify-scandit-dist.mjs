import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, assertPackageParity } from './package-utils.mjs';

const version = assertPackageParity();
const sourceBase = path.join(ROOT, 'public', 'scandit', version);
const distBase = path.join(ROOT, 'dist', 'scandit', version);

if (!fs.existsSync(path.join(ROOT, 'dist'))) {
  throw new Error('dist/ is missing. Run the production build before scandit:verify-dist.');
}

for (const base of [sourceBase, distBase]) {
  if (!fs.existsSync(base)) {
    throw new Error(`Scandit runtime deployment directory missing: ${path.relative(ROOT, base)}`);
  }
}

const sourceManifest = JSON.parse(
  fs.readFileSync(path.join(sourceBase, 'runtime-manifest.json'), 'utf8'),
);
const distManifestPath = path.join(distBase, 'runtime-manifest.json');
if (!fs.existsSync(distManifestPath)) {
  throw new Error('Scandit runtime manifest was not emitted to dist/.');
}
const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));

if (sourceManifest.sdkVersion !== version || distManifest.sdkVersion !== version) {
  throw new Error(
    `Scandit dist version mismatch: expected=${version}, source=${sourceManifest.sdkVersion}, dist=${distManifest.sdkVersion}`,
  );
}

for (const item of sourceManifest.files) {
  const file = path.join(distBase, 'sdc-lib', item.path);
  if (!fs.existsSync(file)) throw new Error(`Built runtime file missing: ${item.path}`);
  const bytes = fs.readFileSync(file);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== item.sha256) throw new Error(`Built runtime hash mismatch: ${item.path}`);
}

console.log(`PASS built Scandit runtime ${version} exactly matches certified source manifest.`);
