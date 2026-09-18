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

    // Only the paths 6.2B ships. The production app already contains historical
    // migrations; the 6.2B boundary script checks the 6.2B Git diff for SQL.
    for (const owned of [
      "src/lib/scanning/capture",
      "src/lib/scanning/providers/scandit",
      "src/components/scanning",
      "src/hooks",
      "src/pages/diagnostics",
      "tests/scanning-6.2b",
      "scripts/scandit",
      "config",
    ]) {
      const full = path.join(root, owned);
      if (fs.existsSync(full)) walk(full);
    }
    expect(sql).toEqual([]);
  });
});
