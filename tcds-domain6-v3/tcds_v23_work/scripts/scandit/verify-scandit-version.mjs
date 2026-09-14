import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CORE, BARCODE, assertPackageParity, readJson } from './package-utils.mjs';
const version = assertPackageParity();
const lockFile = path.join(ROOT, 'package-lock.json');
if (!fs.existsSync(lockFile)) throw new Error('package-lock.json is required for Green Tier 1 certification.');
const lock = readJson(lockFile);
for (const pkg of [CORE, BARCODE]) {
  const key = `node_modules/${pkg}`;
  const locked = lock.packages?.[key]?.version;
  if (locked !== version) throw new Error(`Lockfile mismatch for ${pkg}: installed=${version}, locked=${locked}`);
}
console.log(`PASS Scandit package + lockfile version parity: ${version}`);
