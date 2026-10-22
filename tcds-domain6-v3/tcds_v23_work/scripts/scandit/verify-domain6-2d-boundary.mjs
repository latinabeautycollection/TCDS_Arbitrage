import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const violations = [];
const certifiedSymbologies = new Set(["CODE128", "EAN13_UPCA", "QR"]);

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

for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");

  if (text.includes("@scandit/") && !rel.startsWith("src/lib/scanning/providers/scandit/")) {
    violations.push(`${rel}: Scandit SDK escaped provider boundary`);
  }

  if (rel.startsWith("src/features/") && /\b(pg|postgres|supabase)\b/i.test(text)) {
    violations.push(`${rel}: direct database token found in React/business feature`);
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

if (violations.length) {
  console.error("Domain 6.2D boundary verification FAILED");
  for (const v of violations) console.error(` - ${v}`);
  process.exit(1);
}

console.log("Domain 6.2D boundary verification PASSED");
