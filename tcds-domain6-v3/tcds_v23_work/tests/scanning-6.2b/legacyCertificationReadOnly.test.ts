import {
  describe,
  expect,
  it,
} from "vitest";
import fs from "node:fs";
import path from "node:path";

describe(
  "6.2B certification immutability",
  () => {
    it(
      "does not wire the mutating legacy-retirement helper into the certification package script",
      () => {
        const packageJson =
          JSON.parse(
            fs.readFileSync(
              path.resolve(
                process.cwd(),
                "package.json",
              ),
              "utf8",
            ),
          );

        expect(
          packageJson.scripts[
            "scandit:capture:certify"
          ],
        ).not.toContain(
          "retire-legacy",
        );
      },
    );
  },
);
