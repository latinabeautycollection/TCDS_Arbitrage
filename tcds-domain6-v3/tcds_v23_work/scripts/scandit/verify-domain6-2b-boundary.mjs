import fs from "node:fs";
import path from "node:path";
import {
  execFileSync,
} from "node:child_process";

const root = process.cwd();

const sourceRoots = [
  "src/lib/scanning/capture",
  "src/lib/scanning/providers/scandit",
  "src/components/scanning",
  "src/hooks/useBarcodeScanner.ts",
  "src/pages/diagnostics/ScannerCaptureDiagnosticPage.tsx",
];

const forbiddenBusinessTokens = [
  "/api/",
  "fetch(",
  "axios",
  "receivingApi",
  "pickingApi",
  "packShipApi",
  "returnApi",
  "inventoryApi",
  "warehouse_telemetry",
  "warehouse_control",
  "postgres",
  "supabase",
];

const forbiddenAdvancedModes = [
  "BarcodeBatch",
  "BarcodeTracking",
  "BarcodeCount",
  "SparkScan",
  "BarcodeSelection",
  "MatrixScan",
];

// Identifiers that contain an advanced-mode name but are not that mode.
// BarcodeSelectionPolicy is the 6.2B -> 6.2C capture-policy type (automatic vs
// explicit confirmation); it is not the Scandit Barcode Selection mode.
const allowedIdentifiers = [
  "BarcodeSelectionPolicy",
];

const forbiddenFeatureDirs = [
  "src/features/receiving/",
  "src/features/picking/",
  "src/features/packShip/",
  "src/features/returns/",
  "src/features/storage/",
  "src/features/inventory/",
];

function walk(target) {
  const full =
    path.resolve(root, target);

  if (!fs.existsSync(full)) {
    return [];
  }

  const stat =
    fs.statSync(full);

  if (stat.isFile()) {
    return [full];
  }

  return fs.readdirSync(
    full,
    { withFileTypes: true },
  ).flatMap((entry) => {
    const next =
      path.join(
        full,
        entry.name,
      );

    return entry.isDirectory()
      ? walk(
          path.relative(
            root,
            next,
          ),
        )
      : [next];
  });
}

function git(args) {
  return execFileSync(
    "git",
    args,
    {
      cwd: root,
      encoding: "utf8",
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  ).trim();
}

function requireBaseline() {
  const baseline =
    process.env
      .DOMAIN6_2B_BASELINE_SHA
      ?.trim();

  if (!baseline) {
    throw new Error(
      "DOMAIN6_2B_BASELINE_SHA is required. 6.2B certification fails closed when the production baseline is unknown.",
    );
  }

  if (
    !/^[0-9a-fA-F]{40}$/.test(
      baseline,
    )
  ) {
    throw new Error(
      "DOMAIN6_2B_BASELINE_SHA must be a full 40-character Git SHA.",
    );
  }

  git([
    "cat-file",
    "-e",
    `${baseline}^{commit}`,
  ]);

  return baseline;
}

const violations = [];

for (
  const file of sourceRoots
    .flatMap(walk)
    .filter((value) =>
      /\.(ts|tsx|js|mjs)$/.test(
        value,
      ),
    )
) {
  const rel =
    path.relative(
      root,
      file,
    ).replaceAll("\\", "/");

  const text =
    fs.readFileSync(
      file,
      "utf8",
    );

  for (
    const token of
      forbiddenBusinessTokens
  ) {
    if (text.includes(token)) {
      violations.push(
        `${rel}: forbidden business/API token "${token}"`,
      );
    }
  }

  const textWithoutAllowedIdentifiers =
    allowedIdentifiers.reduce(
      (current, identifier) =>
        current.replaceAll(identifier, ""),
      text,
    );

  for (
    const token of
      forbiddenAdvancedModes
  ) {
    if (textWithoutAllowedIdentifiers.includes(token)) {
      violations.push(
        `${rel}: advanced Scandit mode "${token}" is outside 6.2B`,
      );
    }
  }

  if (
    text.includes("@scandit/") &&
    !rel.startsWith(
      "src/lib/scanning/providers/scandit/",
    )
  ) {
    violations.push(
      `${rel}: Scandit import escaped provider boundary`,
    );
  }
}

let baseline;

try {
  baseline =
    requireBaseline();
} catch (error) {
  console.error(
    "Domain 6.2B boundary verification FAILED",
  );
  console.error(
    ` - ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

let changed;

try {
  changed =
    git([
      "diff",
      "--name-only",
      "--diff-filter=ACMRT",
      `${baseline}...HEAD`,
    ])
      .split(/\r?\n/)
      .map((value) =>
        value.replaceAll("\\", "/"),
      )
      .filter(Boolean);
} catch (error) {
  console.error(
    "Domain 6.2B boundary verification FAILED",
  );
  console.error(
    ` - Git ownership diff failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

if (!changed.length) {
  violations.push(
    "No changed files were found against DOMAIN6_2B_BASELINE_SHA; certification requires a verifiable 6.2B implementation diff.",
  );
}

// Git reports changed paths from the repository root, while the 6.2B ownership
// rules are written against the application root. The application prefix is
// removed before the protected-feature comparison, so the check also works when
// the application is nested inside the repository.
let applicationPrefix = "";

try {
  const repositoryRoot =
    git([
      "rev-parse",
      "--show-toplevel",
    ]).replaceAll("\\", "/");

  const nested =
    path.relative(
      repositoryRoot,
      root,
    ).replaceAll("\\", "/");

  applicationPrefix =
    nested && nested !== "."
      ? `${nested}/`
      : "";
} catch {
  applicationPrefix = "";
}

export function toApplicationPath(
  rel,
  prefix = applicationPrefix,
) {
  return prefix &&
    rel.startsWith(prefix)
    ? rel.slice(prefix.length)
    : rel;
}

for (const rel of changed) {
  const applicationRel =
    toApplicationPath(rel);

  if (
    forbiddenFeatureDirs.some(
      (dir) =>
        applicationRel.startsWith(dir),
    )
  ) {
    violations.push(
      `${rel}: 6.2B may not modify a Domain 6 business feature`,
    );
  }

  if (rel.endsWith(".sql")) {
    violations.push(
      `${rel}: 6.2B may not add or modify SQL`,
    );
  }
}

if (violations.length) {
  console.error(
    "Domain 6.2B boundary verification FAILED",
  );

  for (
    const violation of
      violations
  ) {
    console.error(
      ` - ${violation}`,
    );
  }

  process.exit(1);
}

console.log(
  `Domain 6.2B boundary verification PASSED against baseline ${baseline}`,
);
