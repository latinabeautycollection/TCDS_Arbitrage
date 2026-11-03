import fs from "node:fs";
import path from "node:path";

/**
 * The Scandit SDK must never reach the main bundle. It is loaded on demand by the
 * screens that scan, so a screen that does not scan never downloads it. Wiring a screen
 * to the workflow layer with a static import would silently pull it into the entry
 * chunk for every user, so this runs after every production build.
 */
const root = process.cwd();
const dist = path.join(root, "dist");
// Strings that only the Scandit SDK carries. A static import leaks the SDK's view layer
// first, so its markers are the camera view class and its scandit-* element classes;
// the context and runtime markers cover the rest of the library.
const SDK_MARKERS = [
  "DataCaptureView",
  "scandit-container",
  "data-scandit-default",
  "scandit-paintboard",
  "DataCaptureContext",
  "sdc-lib",
];

function fail(message) {
  console.error(`Domain 6.2D bundle verification FAILED: ${message}`);
  process.exit(1);
}

const indexPath = path.join(dist, "index.html");
if (!fs.existsSync(indexPath)) fail("dist/index.html not found; run the production build first.");

const html = fs.readFileSync(indexPath, "utf8");
const tags = (name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map(([tag]) => tag);
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1];

const entries = tags("script")
  .filter((tag) => attribute(tag, "type") === "module")
  .map((tag) => attribute(tag, "src"))
  .filter(Boolean);
if (!entries.length) fail("no module entry script found in dist/index.html.");

// A chunk the page preloads downloads for every user, just like the entry, so it is held
// to the same rule.
const preloads = tags("link")
  .filter((tag) => attribute(tag, "rel") === "modulepreload")
  .map((tag) => attribute(tag, "href"))
  .filter(Boolean);

for (const reference of [...entries, ...preloads]) {
  const chunk = reference.replace(/^\//, "");
  const file = path.join(dist, chunk);
  if (!fs.existsSync(file)) fail(`${chunk} is referenced but missing.`);
  const text = fs.readFileSync(file, "utf8");
  const found = SDK_MARKERS.filter((marker) => text.includes(marker));
  if (found.length) {
    fail(`${chunk} contains the Scandit SDK (${found.join(", ")}). Load scanning screens lazily.`);
  }
  console.log(`Domain 6.2D bundle verification PASSED: ${chunk} is ${(fs.statSync(file).size / 1024).toFixed(1)} kB with no Scandit SDK`);
}
