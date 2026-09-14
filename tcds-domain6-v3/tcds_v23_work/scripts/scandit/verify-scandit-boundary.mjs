import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const allowed = path.resolve(root, 'lib/scanning/providers/scandit');
const violations = [];

const sourceExtensions = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const scanditReference =
  /(?:from\s*['"]@scandit\/|import\s*\(\s*['"]@scandit\/|require\s*\(\s*['"]@scandit\/|export\s+[^;]*from\s*['"]@scandit\/|['"]@scandit\/)/m;

function isInsideAllowed(file) {
  const relative = path.relative(allowed, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (!sourceExtensions.test(entry.name)) continue;

    const text = fs.readFileSync(full, 'utf8');
    if (scanditReference.test(text) && !isInsideAllowed(full)) {
      violations.push(path.relative(process.cwd(), full));
    }
  }
}

walk(root);

if (violations.length) {
  throw new Error(
    `Scandit import boundary violated. Only src/lib/scanning/providers/scandit/** may reference @scandit/*:\n${violations.join('\n')}`,
  );
}

console.log('PASS Scandit imports/re-exports/dynamic imports are isolated to provider boundary.');
