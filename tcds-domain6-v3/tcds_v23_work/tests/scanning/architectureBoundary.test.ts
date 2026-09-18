import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const allowedRoot = path.resolve(srcRoot, 'lib/scanning/providers/scandit');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('Scandit architecture boundary', () => {
  it('contains every @scandit reference inside provider implementation', () => {
    const violations = walk(srcRoot)
      .filter((file) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(file))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('@scandit/'))
      .filter((file) => {
        const relative = path.relative(allowedRoot, path.resolve(file));
        return relative.startsWith('..') || path.isAbsolute(relative);
      });

    expect(violations).toEqual([]);
  });
});
