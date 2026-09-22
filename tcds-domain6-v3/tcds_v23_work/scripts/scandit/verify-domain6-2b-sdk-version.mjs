import fs from "node:fs";
import path from "node:path";

const EXPECTED = "8.5.3";

const packages = [
  "@scandit/web-datacapture-core",
  "@scandit/web-datacapture-barcode",
];

const root = process.cwd();
const pkg =
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        "package.json",
      ),
      "utf8",
    ),
  );

const lock =
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        "package-lock.json",
      ),
      "utf8",
    ),
  );

const failures = [];

for (const name of packages) {
  const declared =
    pkg.dependencies?.[name] ??
    pkg.devDependencies?.[name];

  if (declared !== EXPECTED) {
    failures.push(
      `${name}: package.json must pin exact ${EXPECTED}; found ${String(declared)}`,
    );
  }

  const lockKey =
    `node_modules/${name}`;

  const resolved =
    lock.packages?.[lockKey]
      ?.version;

  if (resolved !== EXPECTED) {
    failures.push(
      `${name}: package-lock must resolve ${EXPECTED}; found ${String(resolved)}`,
    );
  }

  const installedPackageJson =
    path.resolve(
      root,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );

  if (
    !fs.existsSync(
      installedPackageJson,
    )
  ) {
    failures.push(
      `${name}: package is not installed`,
    );
    continue;
  }

  const installed =
    JSON.parse(
      fs.readFileSync(
        installedPackageJson,
        "utf8",
      ),
    ).version;

  if (installed !== EXPECTED) {
    failures.push(
      `${name}: installed version must be ${EXPECTED}; found ${String(installed)}`,
    );
  }
}

if (failures.length) {
  console.error(
    "Domain 6.2B Scandit SDK version verification FAILED",
  );
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Domain 6.2B Scandit SDK version verification PASSED (${EXPECTED})`,
);
