import {
  describe,
  expect,
  it,
} from "vitest";
import fs from "node:fs";
import path from "node:path";

describe(
  "6.2C slice ownership",
  () => {
    it(
      "contains no Scandit imports and no 6.2B implementation copies",
      () => {
        const root =
          path.resolve(
            process.cwd(),
            "src/lib/scanning/policy",
          );

        const files =
          fs.readdirSync(
            root,
          )
          .filter(
            (file) =>
              file.endsWith(
                ".ts",
              ),
          );

        const text =
          files
            .map((file) =>
              fs.readFileSync(
                path.join(
                  root,
                  file,
                ),
                "utf8",
              ),
            )
            .join("\n");

        expect(text).not.toContain(
          "@scandit/",
        );
        expect(text).not.toContain(
          "DataCaptureView",
        );
        expect(text).not.toContain(
          "BarcodeCaptureSettings",
        );
        expect(text).not.toContain(
          "navigator.vibrate",
        );
        expect(text).not.toContain(
          "AudioContext",
        );
      },
    );
  },
);
