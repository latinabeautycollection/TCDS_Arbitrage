import fs from "node:fs";
import path from "node:path";

const legacy = path.resolve(
  process.cwd(),
  "src/lib/scanditAdapter.ts",
);

if (!fs.existsSync(legacy)) {
  console.log(
    "Legacy scanditAdapter.ts is absent: PASS",
  );
  process.exit(0);
}

const text =
  fs.readFileSync(
    legacy,
    "utf8",
  );

if (
  text.includes(
    "startScannerPlaceholder",
  )
) {
  console.error(
    "Legacy src/lib/scanditAdapter.ts placeholder is still present. Remove it in a reviewed implementation commit before certification.",
  );
  process.exit(1);
}

console.error(
  "src/lib/scanditAdapter.ts still exists. 6.2B certification requires one authoritative scanner integration path; review and retire this file explicitly.",
);
process.exit(1);
