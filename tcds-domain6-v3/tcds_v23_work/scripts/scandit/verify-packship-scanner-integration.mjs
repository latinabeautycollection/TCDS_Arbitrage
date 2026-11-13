import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const violations = [];

function read(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    violations.push(`${rel}: required file missing`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

const panel = read("src/features/packShip/components/PackShipScannerPanel.tsx");
const screen = read("src/features/packShip/PackShipScreen.tsx");
const router = read("src/routes/AppRouter.tsx");
const plan = read("src/features/packShip/scanning/packShipScanPlan.ts");
const adapter = read("src/lib/scanning/workflow/adapters/ProductionWorkflowAdapter.ts");
const policy = read("src/lib/scanning/workflow/policy/CapturePolicyAuthority.ts");
const coordinator = read("src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator.ts");
const manual = read("src/features/packShip/scanning/packShipManualOperation.ts");
const retry = read("src/features/packShip/scanning/packShipRetry.ts");
const snapshot = read("src/features/packShip/scanning/packShipTaskSnapshot.ts");
const source = read("src/features/packShip/scanning/warehouseControlCaptureSnapshotSource.ts");
const authority = read("src/features/packShip/scanning/packShipCapturePolicyAuthority.ts");
const api = read("src/features/packShip/services/packShipApi.ts");
const messages = read("src/features/packShip/messages/packShipMessageCatalog.ts");

for (const [rel, text] of [
  ["PackShipScannerPanel", panel],
  ["packShipScanPlan", plan],
  ["packShipManualOperation", manual],
]) {
  if (/@scandit\//.test(text)) violations.push(`${rel}: direct Scandit SDK import escaped 6.2B provider boundary`);
  if (/\bfetch\s*\(/.test(text) || text.includes("/api/v1/")) violations.push(`${rel}: direct HTTP route bypasses existing Pack/Ship API helper`);
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(text)) violations.push(`${rel}: SQL/business persistence escaped browser boundary`);
}

if (!screen.includes("lazy(async ()" ) || !screen.includes("import('./components/PackShipScannerPanel')")) {
  violations.push("PackShipScreen: scanner implementation is not lazy-loaded");
}
if (/import\s+\{?\s*PackShipScannerPanel/.test(screen)) {
  violations.push("PackShipScreen: static PackShipScannerPanel import can leak Scandit into the entry bundle");
}
if (!router.includes("capturePolicyAuthority={packShipCapturePolicyAuthority}")) {
  violations.push("AppRouter: production PackShip route does not inject CertifiedCapturePolicyAuthority");
}
if (!authority.includes("CertifiedCapturePolicyAuthority") || !authority.includes("WarehouseControlHttpCaptureSnapshotSource")) {
  violations.push("PackShip capture policy binding is not connected to certified 6.2C through the governed snapshot source");
}
if (!source.includes("credentials: \"include\"") || !source.includes("cache: \"no-store\"")) {
  violations.push("Warehouse Control snapshot source lacks authenticated/no-store request semantics");
}
if (/deviceId|stationId|facilityId|employeeId/.test(source.split("async load")[1] ?? "")) {
  violations.push("Warehouse Control snapshot request appears to accept client-selected identity");
}

if (!screen.includes("selectPackShipTaskSnapshot")) {
  violations.push("PackShipScreen: authoritative task responses do not use the monotonic snapshot gate");
}
if (/setTask\s*\(\s*await\s+packShipApi/.test(screen)) {
  violations.push("PackShipScreen: raw task response bypasses the monotonic snapshot gate");
}
if (screen.includes("lastOperation")) {
  violations.push("PackShipScreen: generic lastOperation retry model remains");
}
if (!screen.includes("isUncertainPackShipError") || !screen.includes("pendingRetry")) {
  violations.push("PackShipScreen: uncertain-operation-only manual retry model missing");
}
if (!retry.includes("HTTP_5") || !retry.includes("REQUEST_TIMEOUT") || !retry.includes("NETWORK_ERROR")) {
  violations.push("packShipRetry: uncertain failure classification incomplete");
}
if (!snapshot.includes("CROSS_TASK_RESPONSE_BLOCKED") || !snapshot.includes("chooseNewestPackShipTaskSnapshot")) {
  violations.push("packShipTaskSnapshot: cross-task/monotonic ordering gate incomplete");
}

if (!panel.includes("key={plan.sessionKey}")) {
  violations.push("PackShipScannerPanel: profile/session transition does not force a fresh scanner coordinator boundary");
}
if (!panel.includes("void scanner.stop().catch") || !panel.includes("Explicit cleanup")) {
  violations.push("PackShipScannerPanel: keyed transition lacks explicit old scanner release");
}
if (!panel.includes("packShipLabelPairScopeKey")) {
  violations.push("PackShipScannerPanel: transient tracking proof is not task/shipment/label scoped");
}
if (!panel.includes("trackingClientOperationId") || !panel.includes("trackingCorrelationId") || !panel.includes("observationId")) {
  violations.push("PackShipScannerPanel: first physical tracking observation lineage is incomplete");
}
if (!panel.includes("CROSS_TASK_RESPONSE_BLOCKED")) {
  violations.push("PackShipScannerPanel: accepted server response is not guarded against cross-task contamination");
}
if (!manual.includes("createWarehouseClientOperation")) {
  violations.push("packShipManualOperation: manual/HID retries do not bind a stable 6.2D operation identity");
}
if (!coordinator.includes("context: snapshotContext(ctx)")) {
  violations.push("WorkflowScanCoordinator: uncertain retry does not persist original workflow context");
}
if (!coordinator.includes("this.pending.context")) {
  violations.push("WorkflowScanCoordinator: retry may use refreshed UI context under an old idempotency key");
}
if (!coordinator.includes("trackingEvidence: { ...ctx.adapterContext.trackingEvidence }")) {
  violations.push("WorkflowScanCoordinator: tracking evidence context is not snapshotted for deterministic retry");
}
if (adapter.includes('workflowStep === "PACK_VERIFY_LABEL"')) {
  violations.push("ProductionWorkflowAdapter: legacy one-step label route still creates dual physical-proof semantics");
}
if (policy.includes('workflowStep === "PACK_VERIFY_LABEL"')) {
  violations.push("CapturePolicyAuthority: legacy one-step label route remains mapped");
}
if (!adapter.includes("labelPairId") || !adapter.includes("packageClientOperationId") || !adapter.includes("trackingEvidence")) {
  violations.push("ProductionWorkflowAdapter: deterministic two-observation label-pair lineage missing");
}
if (!api.includes("physicalEvidence: evidence")) {
  violations.push("packShipApi: label-pair physical evidence is not propagated to authoritative backend contract");
}

for (const code of [
  "CROSS_TASK_RESPONSE_BLOCKED",
  "TRACKING_SCAN_RESULT_MISSING",
  "CAPTURE_POLICY_SNAPSHOT_UNAVAILABLE",
  "CAPTURE_SNAPSHOT_INVALID",
  "PENDING_SCAN_UNRESOLVED",
  "OFFLINE_VALIDATION_UNAVAILABLE",
  "LABEL_CONTEXT_REQUIRED",
]) {
  if (!messages.includes(`${code}:`)) violations.push(`packShipMessageCatalog: explicit ${code} employee guidance missing`);
}
for (const required of ["PACK_TRACKING_LABEL", "PACK_PACKAGE", "PACK_OUTBOUND_LOCATION"]) {
  if (!plan.includes(required)) violations.push(`packShipScanPlan: ${required} missing`);
}

if (violations.length) {
  console.error("Pack/Ship scanner integration verification FAILED");
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log("Pack/Ship scanner integration verification PASSED");
