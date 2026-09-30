import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root =
  process.cwd();

const sourceRoot =
  path.resolve(
    root,
    "src/lib/scanning/policy",
  );

const files = [];

function walk(dir) {
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
      entry.name.endsWith(
        ".ts",
      )
    ) {
      files.push(full);
    }
  }
}

walk(sourceRoot);

const manifest = {
  slice: "6.2C",
  registryVersion:
    "6.2C.2",
  authority:
    "warehouse_control/PostgreSQL",
  executionOwner:
    "6.2B",
  files: {},
};

for (const file of files.sort()) {
  const rel =
    path.relative(
      root,
      file,
    ).replaceAll(
      "\\",
      "/",
    );

  const data =
    fs.readFileSync(file);

  manifest.files[rel] = {
    sha256:
      crypto
        .createHash(
          "sha256",
        )
        .update(data)
        .digest("hex"),
    bytes: data.length,
  };
}

fs.writeFileSync(
  path.resolve(
    root,
    "domain6-2c-policy-manifest.json",
  ),
  JSON.stringify(
    manifest,
    null,
    2,
  ) + "\n",
);

console.log(
  "Generated domain6-2c-policy-manifest.json",
);
