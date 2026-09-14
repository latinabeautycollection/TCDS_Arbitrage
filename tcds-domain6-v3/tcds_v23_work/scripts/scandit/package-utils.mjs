import fs from 'node:fs';
import path from 'node:path';

export const ROOT = process.cwd();
export const CORE = '@scandit/web-datacapture-core';
export const BARCODE = '@scandit/web-datacapture-barcode';

export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function resolvePackageRoot(name) {
  const packageJson = requireResolvePackageJson(name);
  return path.dirname(packageJson);
}
function requireResolvePackageJson(name) {
  const candidates = [
    path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json'),
  ];
  const hit = candidates.find(fs.existsSync);
  if (!hit) throw new Error(`Cannot locate ${name}/package.json. Run npm ci first.`);
  return hit;
}
export function installedVersion(name) { return readJson(requireResolvePackageJson(name)).version; }
export function assertPackageParity() {
  const core = installedVersion(CORE);
  const barcode = installedVersion(BARCODE);
  if (core !== barcode) throw new Error(`Scandit version mismatch: core=${core}, barcode=${barcode}`);
  return core;
}
export function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full)); else if (entry.isFile()) out.push(full);
  }
  return out;
}
