import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  applicationRelative,
  isOwnedByDomain6_2D,
  isDomain6_2BImplementation,
  isDomain6_2CImplementation,
} from "./sliceOwnership.mjs";

const root = process.cwd();
const violations = [];

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function walk(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.relative(root, path.join(full, e.name)))
      : [path.join(full, e.name)]
  );
}

/* ------------------------------------------------------------------ *
 * 1. Source content rules
 * ------------------------------------------------------------------ */

// Real database coupling, not the mere appearance of a word. A readiness field
// named `postgres` is a status label, not a database client.
const databaseCoupling = [
  {
    pattern: /(?:import[^;\n]*from\s*|require\(\s*)["'](?:pg|pg-promise|postgres|postgres\.js|mysql2?|knex|typeorm|sequelize|drizzle-orm)(?:\/[^"']*)?["']/,
    detail: "imports a database driver or query builder",
  },
  {
    pattern: /(?:import[^;\n]*from\s*|require\(\s*)["']@supabase\/[^"']*["']/,
    detail: "imports a Supabase client",
  },
  {
    pattern: /\bcreateClient\s*\(\s*[^)]*(?:supabase|SUPABASE)/,
    detail: "creates a Supabase client",
  },
  {
    pattern: /\b(?:pool|client|db|database|conn|connection|knex|sql)\s*\.\s*(?:query|execute|raw|unsafe)\s*\(/,
    detail: "executes a query through a database client",
  },
  {
    pattern: /\b(?:SELECT\s+[\s\S]{0,200}?\sFROM\s|INSERT\s+INTO\s|UPDATE\s+[A-Za-z_."]+\s+SET\s|DELETE\s+FROM\s)/i,
    detail: "contains inline SQL",
  },
  {
    pattern: /(?:import[^;\n]*from\s*|require\(\s*)["'][^"']*(?:\/src\/domains\/|\/database\/|\/db\/(?:pool|client|adapter))[^"']*["']/,
    detail: "imports a server or database adapter directly",
  },
];

for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");

  if (text.includes("@scandit/") && !rel.startsWith("src/lib/scanning/providers/scandit/")) {
    violations.push(`${rel}: Scandit SDK escaped provider boundary`);
  }

  if (rel.startsWith("src/features/")) {
    for (const { pattern, detail } of databaseCoupling) {
      if (pattern.test(text)) {
        violations.push(`${rel}: ${detail}; business features reach the database through the existing services only`);
      }
    }
  }

  if (rel.startsWith("src/lib/scanning/providers/") &&
      /(receivingApi|storageApi|pickingApi|packShipApi|inventoryApi|returnsApi|\/api\/v1\/)/.test(text)) {
    violations.push(`${rel}: scanner provider depends on warehouse business API`);
  }

  if (/arb\.(decisions|purchase_queue|shipments|ebay_|listing)/i.test(text)) {
    violations.push(`${rel}: prohibited direct ARB reference`);
  }
}

const workflowDir = path.join(root, "src/lib/scanning/workflow");
if (fs.existsSync(workflowDir)) {
  const text = walk("src/lib/scanning/workflow")
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  for (const token of ["DATA_MATRIX", "EAN8", "CODE39", "ITF"]) {
    if (text.includes(`"${token}"`) || text.includes(`'${token}'`)) {
      violations.push(`6.2D workflow advertises unsupported symbology ${token}`);
    }
  }

  if (/class\s+(ReceivingRepository|PutawayRepository|PickingRepository|PackingRepository|InventoryRepository|ReturnsRepository|OutboundRepository)\b/.test(text)) {
    violations.push("6.2D reintroduced duplicate warehouse business repositories");
  }
}

/* ------------------------------------------------------------------ *
 * 2. Slice ownership of the implementation diff
 *
 * 6.2D is judged by this gate, so this gate decides whether the changes
 * it makes are ones 6.2D is allowed to make. It fails closed.
 * ------------------------------------------------------------------ */

const baseline = process.env.DOMAIN6_2D_BASELINE_SHA?.trim();

if (!baseline || !/^[0-9a-fA-F]{40}$/.test(baseline)) {
  console.error(
    "Domain 6.2D boundary verification FAILED: DOMAIN6_2D_BASELINE_SHA must be a full 40-character SHA.",
  );
  process.exit(1);
}

try {
  git(["cat-file", "-e", `${baseline}^{commit}`]);
} catch {
  console.error("Domain 6.2D boundary verification FAILED: baseline commit is not available.");
  process.exit(1);
}

let changed;
try {
  changed = git(["diff", "--name-only", "--diff-filter=ACMRT", `${baseline}...HEAD`])
    .split(/\r?\n/)
    .map((value) => value.replaceAll("\\", "/"))
    .filter(Boolean);
} catch {
  console.error("Domain 6.2D boundary verification FAILED: Git diff could not be computed.");
  process.exit(1);
}

if (!changed.length) {
  console.error("Domain 6.2D boundary verification FAILED: no implementation diff exists.");
  process.exit(1);
}

// Git reports paths from the repository root while ownership is written against the
// application root, so the nesting prefix is removed before every comparison. The
// reported path is left exactly as Git prints it.
let applicationPrefix = "";
try {
  const repositoryRoot = git(["rev-parse", "--show-toplevel"]).replaceAll("\\", "/");
  const nested = path.relative(repositoryRoot, root).replaceAll("\\", "/");
  applicationPrefix = nested && nested !== "." ? `${nested}/` : "";
} catch {
  applicationPrefix = "";
}

const ALWAYS_ALLOWED = ["package.json", "package-lock.json"];

for (const rel of changed) {
  const appRel = applicationRelative(rel, applicationPrefix);

  if (ALWAYS_ALLOWED.includes(appRel) || isOwnedByDomain6_2D(appRel)) continue;

  if (isDomain6_2BImplementation(appRel)) {
    violations.push(`${rel}: 6.2D may not modify 6.2B capture or provider implementation.`);
    continue;
  }

  if (isDomain6_2CImplementation(appRel)) {
    violations.push(`${rel}: 6.2D may not modify 6.2C policy implementation.`);
    continue;
  }

  if (appRel.startsWith("src/features/")) {
    violations.push(`${rel}: 6.2D may only modify the approved API helper in a Domain 6 business feature.`);
    continue;
  }

  if (appRel.startsWith("src/")) {
    violations.push(`${rel}: source change is outside the 6.2D ownership.`);
  }
}

if (violations.length) {
  console.error("Domain 6.2D boundary verification FAILED");
  for (const v of violations) console.error(` - ${v}`);
  process.exit(1);
}

console.log(`Domain 6.2D boundary verification PASSED against baseline ${baseline}`);
