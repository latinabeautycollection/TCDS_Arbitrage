import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CORE, BARCODE, assertPackageParity, resolvePackageRoot } from './package-utils.mjs';

const version = assertPackageParity();
const dest = path.join(ROOT, 'public', 'scandit', version, 'sdc-lib');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const pkg of [CORE, BARCODE]) {
  const src = path.join(resolvePackageRoot(pkg), 'sdc-lib');
  if (!fs.existsSync(src)) throw new Error(`Missing sdc-lib in ${pkg}`);
  // Scandit ships a zero-byte .gitkeep inside sdc-lib. It is packaging metadata,
  // not runtime, and it would otherwise be manifested and then rejected by
  // verify-scandit-runtime.mjs. Excluded by name only, so any other zero-byte
  // runtime artifact is still manifested and still fails verification.
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (source) => path.basename(source) !== '.gitkeep',
  });
}
console.log(`Scandit runtime synchronized to ${dest}`);
