import fs from "node:fs";
import path from "node:path";
import {
  execFileSync,
} from "node:child_process";

const root = process.cwd();

const allowedPrefixes = [
  "src/lib/scanning/policy/",
  "src/components/scanning/policy/",
  "tests/scanning-6.2c/",
  "config/vitest/scandit-6.2c.vitest.config.ts",
  "scripts/scandit/verify-domain6-2c-boundary.mjs",
  "scripts/scandit/generate-domain6-2c-policy-manifest.mjs",
  "docs/domain6-2c/",
  "package.json",
  "package-lock.json",
];

const forbiddenPrefixes = [
  "src/features/receiving/",
  "src/features/picking/",
  "src/features/packShip/",
  "src/features/returns/",
  "src/features/storage/",
  "src/features/inventory/",
  "src/lib/scanning/providers/scandit/",
  "src/lib/scanning/capture/",
  "src/hooks/useBarcodeScanner.ts",
];

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

const baseline =
  process.env
    .DOMAIN6_2C_BASELINE_SHA
    ?.trim();

if (
  !baseline ||
  !/^[0-9a-fA-F]{40}$/.test(
    baseline,
  )
) {
  console.error(
    "Domain 6.2C boundary verification FAILED: DOMAIN6_2C_BASELINE_SHA must be a full 40-character SHA.",
  );
  process.exit(1);
}

try {
  git([
    "cat-file",
    "-e",
    `${baseline}^{commit}`,
  ]);
} catch {
  console.error(
    "Domain 6.2C boundary verification FAILED: baseline commit is not available.",
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
        value.replaceAll(
          "\\",
          "/",
        ),
      )
      .filter(Boolean);
} catch (error) {
  console.error(
    "Domain 6.2C boundary verification FAILED: Git diff could not be computed.",
  );
  process.exit(1);
}

if (!changed.length) {
  console.error(
    "Domain 6.2C boundary verification FAILED: no implementation diff exists.",
  );
  process.exit(1);
}

// Git reports changed paths from the repository root, while the 6.2C ownership
// rules are written against the application root. The application prefix is
// removed before every prefix comparison, so the rules also apply when the
// application is nested inside the repository. Reported paths stay unchanged.
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

const violations = [];

for (const rel of changed) {
  const applicationRel =
    toApplicationPath(rel);

  if (
    rel.endsWith(".sql")
  ) {
    violations.push(
      `${rel}: 6.2C may not add or modify SQL.`,
    );
  }

  if (
    forbiddenPrefixes.some(
      (prefix) =>
        applicationRel.startsWith(prefix),
    )
  ) {
    violations.push(
      `${rel}: 6.2C may not modify 6.2B implementation or a Domain 6 business feature.`,
    );
  }

  if (
    applicationRel.startsWith("src/") &&
    !allowedPrefixes.some(
      (prefix) =>
        applicationRel.startsWith(prefix),
    )
  ) {
    violations.push(
      `${rel}: source change is outside the 6.2C allowlist.`,
    );
  }
}

const sourceFiles = [];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (
    const entry of
      fs.readdirSync(
        dir,
        {
          withFileTypes: true,
        },
      )
  ) {
    const full =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(full);
    } else if (
      /\.(ts|tsx)$/.test(
        entry.name,
      )
    ) {
      sourceFiles.push(full);
    }
  }
}

walk(
  path.resolve(
    root,
    "src/lib/scanning/policy",
  ),
);

const forbiddenSourceTokens = [
  "@scandit/",
  "BarcodeCaptureSettings",
  "DataCaptureView",
  "navigator.vibrate",
  "AudioContext",
  "fetch(",
  "axios",
  "receivingApi",
  "pickingApi",
  "packShipApi",
  "returnApi",
  "inventoryApi",
  "warehouse_telemetry",
  "INSERT ",
  "UPDATE ",
  "DELETE ",
];

for (const file of sourceFiles) {
  const rel =
    path.relative(
      root,
      file,
    ).replaceAll(
      "\\",
      "/",
    );

  const text =
    fs.readFileSync(
      file,
      "utf8",
    );

  for (
    const token of
      forbiddenSourceTokens
  ) {
    if (
      text.includes(token)
    ) {
      violations.push(
        `${rel}: forbidden 6.2B/business/data-access token "${token}".`,
      );
    }
  }
}

if (violations.length) {
  console.error(
    "Domain 6.2C boundary verification FAILED",
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
  `Domain 6.2C boundary verification PASSED against baseline ${baseline}`,
);
