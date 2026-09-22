// IMPLEMENTATION MIGRATION HELPER ONLY.
// NEVER invoke this script from certification/CI; certification is read-only.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const legacyRel =
  "src/lib/scanditAdapter.ts";
const legacy = path.resolve(
  root,
  legacyRel,
);

if (!fs.existsSync(legacy)) {
  console.log(
    "Legacy scanditAdapter.ts is already absent.",
  );
  process.exit(0);
}

const legacyText =
  fs.readFileSync(
    legacy,
    "utf8",
  );

if (
  !legacyText.includes(
    "startScannerPlaceholder",
  )
) {
  console.log(
    "scanditAdapter.ts does not contain the legacy placeholder; no automatic action taken.",
  );
  process.exit(0);
}

const searchRoots = [
  path.resolve(root, "src"),
];

const importHits = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true },
    )
  ) {
    const full = path.join(
      dir,
      entry.name,
    );

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (
      !/\.(ts|tsx|js|jsx)$/.test(
        entry.name,
      )
    ) {
      continue;
    }

    if (
      path.resolve(full) === legacy
    ) {
      continue;
    }

    const text =
      fs.readFileSync(
        full,
        "utf8",
      );

    if (
      text.includes(
        "scanditAdapter",
      ) ||
      text.includes(
        "startScannerPlaceholder",
      )
    ) {
      importHits.push(
        path.relative(
          root,
          full,
        ).replaceAll("\\", "/"),
      );
    }
  }
}

for (const searchRoot of searchRoots) {
  walk(searchRoot);
}

if (importHits.length) {
  console.error(
    "Legacy scanditAdapter.ts is still referenced. 6.2B cannot modify Domain 6 feature owners automatically.",
  );
  for (const hit of importHits) {
    console.error(` - ${hit}`);
  }
  process.exit(1);
}

fs.unlinkSync(legacy);

console.log(
  `Retired unused legacy placeholder: ${legacyRel}`,
);
