import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, CORE, BARCODE, assertPackageParity, walkFiles } from './package-utils.mjs';
const version = assertPackageParity();
const base = path.join(ROOT, 'public', 'scandit', version);
const lib = path.join(base, 'sdc-lib');
if (!fs.existsSync(lib)) throw new Error('Runtime not synchronized. Run scandit:sync first.');
const files = walkFiles(lib).map(file => {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(lib, file).replaceAll(path.sep, '/'), size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}).sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { provider: 'scandit', sdkVersion: version, generatedAt: new Date().toISOString(), packages: { [CORE]: version, [BARCODE]: version }, files };
fs.writeFileSync(path.join(base, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Manifest generated with ${files.length} files.`);
