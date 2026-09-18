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
        const fragment =
          JSON.parse(
            fs.readFileSync(
              path.resolve(
                process.cwd(),
                "package-fragment.json",
              ),
              "utf8",
            ),
          );

        expect(
          fragment.scripts[
            "scandit:capture:certify"
          ],
        ).not.toContain(
          "retire-legacy",
        );
      },
    );
  },
);
