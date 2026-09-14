import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, assertPackageParity } from './package-utils.mjs';
const version = assertPackageParity();
const base = path.join(ROOT, 'public', 'scandit', version);
const lib = path.join(base, 'sdc-lib');
const manifestFile = path.join(base, 'runtime-manifest.json');
if (!fs.existsSync(lib) || !fs.existsSync(manifestFile)) throw new Error('Runtime or manifest missing.');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.sdkVersion !== version) throw new Error(`Manifest version mismatch: ${manifest.sdkVersion} != ${version}`);
let wasm = 0, js = 0;
for (const item of manifest.files) {
  const file = path.join(lib, item.path);
  if (!fs.existsSync(file)) throw new Error(`Runtime file missing: ${item.path}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0) throw new Error(`Zero-byte runtime file: ${item.path}`);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== item.sha256) throw new Error(`Hash mismatch: ${item.path}`);
  if (item.path.endsWith('.wasm')) wasm++;
  if (item.path.endsWith('.js')) js++;
}
if (!wasm) throw new Error('No WASM runtime files found.');
if (!js) throw new Error('No JS runtime files found.');
console.log(`PASS runtime ${version}: ${manifest.files.length} files, ${wasm} WASM, ${js} JS`);
