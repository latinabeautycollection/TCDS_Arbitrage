import {
  describe,
  expect,
  it,
} from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("6.2B production compatibility", () => {
  it("does not permit the legacy startScannerPlaceholder integration surface", () => {
    const legacy = path.resolve(
      process.cwd(),
      "src/lib/scanditAdapter.ts",
    );

    if (!fs.existsSync(legacy)) {
      expect(true).toBe(true);
      return;
    }

    const text =
      fs.readFileSync(
        legacy,
        "utf8",
      );

    expect(
      text,
    ).not.toContain(
      "startScannerPlaceholder",
    );
  });
});
