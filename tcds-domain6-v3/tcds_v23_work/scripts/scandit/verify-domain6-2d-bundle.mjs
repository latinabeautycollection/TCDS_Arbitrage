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

const entries = [...fs.readFileSync(indexPath, "utf8").matchAll(/<script[^>]+type="module"[^>]+src="\/?([^"]+\.js)"/g)]
  .map((match) => match[1]);
if (!entries.length) fail("no module entry script found in dist/index.html.");

for (const entry of entries) {
  const file = path.join(dist, entry);
  if (!fs.existsSync(file)) fail(`${entry} is referenced but missing.`);
  const text = fs.readFileSync(file, "utf8");
  const found = SDK_MARKERS.filter((marker) => text.includes(marker));
  if (found.length) {
    fail(`${entry} contains the Scandit SDK (${found.join(", ")}). Load scanning screens lazily.`);
  }
  console.log(`Domain 6.2D bundle verification PASSED: ${entry} is ${(fs.statSync(file).size / 1024).toFixed(1)} kB with no Scandit SDK`);
}
