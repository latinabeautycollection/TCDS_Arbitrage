import fs from 'node:fs';
import path from 'node:path';
import { ROOT, assertPackageParity } from './package-utils.mjs';
const version = assertPackageParity();
const target = path.join(ROOT, 'src/lib/scanning/providers/scandit/scanditVersion.ts');
fs.writeFileSync(target, `export const APPROVED_SCANDIT_VERSION = '${version}' as const;\nexport function assertApprovedScanditVersion(version: string): string { if (!version) throw new Error('Scandit version missing.'); return version; }\n`);
console.log(`Generated browser-safe Scandit version contract: ${version}`);
