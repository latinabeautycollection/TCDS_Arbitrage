import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

describe("6.2B authority boundary", () => {
  it("ships no SQL migrations", () => {
    const root = process.cwd();
    const sql: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith(".sql")) sql.push(full);
      }
    }

    walk(root);
    expect(sql).toEqual([]);
  });
});
