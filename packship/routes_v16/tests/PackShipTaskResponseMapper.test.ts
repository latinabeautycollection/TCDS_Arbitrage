import { PackShipTaskResponseMapper, mapSnapshot } from "../src/domains/packShip/mappers/PackShipTaskResponseMapper";

// A V0.2.1 snapshot shaped exactly like warehouse.packship__snapshot returns it.
const BASE: any = {
  packingTaskId: "11111111-1111-4111-8111-111111111111", taskNumber: "PK-1", status: "CONTENTS_VERIFYING", rowVersion: 7,
  facilityId: "22222222-2222-4222-8222-222222222222", assignedStationId: "44444444-4444-4444-8444-444444444444",
  fulfillmentOrderId: "33333333-3333-4333-8333-333333333333",
  claim: { heldBySession: true, employeeId: "e", deviceId: "d", expiresAt: "2026-11-17T10:00:00Z", expired: false },
  sourceVerified: true,
  items: [{ packingTaskItemId: "i1", itemId: "55555555-5555-4555-8555-555555555555", expectedBarcode: "TCDS-ITEM-1",
    expectedQuantity: 1, verifiedQuantity: 0, status: "PENDING", rowVersion: 1, title: "Test Phone 128GB" }],
  package: null, shipment: null, blockers: ["ITEMS_UNVERIFIED"],
  snapshotVersion: "0.2.1", carrierCutoffAt: "2026-12-01T16:00:00Z",
  facility: { facilityCode: "LV2TEST" }, station: { stationCode: "PACK-01" },
  order: { externalOrderId: "EXT-123", shipByAt: null },
  evidence: { requirementCount: 0, required: 0, accepted: 0, pending: 0, rejected: 0, integrityVerified: false },
  stationReadiness: null, printJob: null,
};
const snap = (over: any = {}) => ({ ...BASE, ...over });
const gate = (t: any, code: string) => t.completionGates.find((g: any) => g.code === code).state;
const LABEL_VERIFIED = snap({
  status: "LABEL_VERIFIED", blockers: [],
  items: [{ ...BASE.items[0], verifiedQuantity: 1, status: "PACKED" }],
  package: { packageId: "66666666-6666-4666-8666-666666666666", packageNumber: "TCDS-PKG-1", status: "PACKED", rowVersion: 4,
    weightOz: 12.5, lengthIn: 10, widthIn: 8, heightIn: 4 },
  shipment: { shipmentId: "77777777-7777-4777-8777-777777777777", carrierCode: "UPS", status: "LABEL_PURCHASED", trackingPresent: true },
  printJob: { printJobId: "p", jobType: "SHIPPING_LABEL", status: "VERIFIED", attemptCount: 1, completedAt: null, updatedAt: "x" },
});

describe("PackShipTaskResponseMapper (V0.2.1, no database access)", () => {
  it("takes no pool and maps identity and metadata from the snapshot", async () => {
    const t: any = await new PackShipTaskResponseMapper().map(snap());
    expect(t.taskId).toBe(BASE.packingTaskId); expect(t.rowVersion).toBe(7);
    expect(t.orderNumber).toBe("EXT-123"); expect(t.facilityCode).toBe("LV2TEST"); expect(t.stationCode).toBe("PACK-01");
    expect(t.carrierCutoffAt).toBe("2026-12-01T16:00:00Z"); expect(t.items[0].title).toBe("Test Phone 128GB");
    expect(t.readiness.postgres).toBe("UNKNOWN"); expect(gate(t, "CONTENTS")).toBe("PENDING");
  });
  it("shows an explicit placeholder, not an invented title, when the item has no product profile", () => {
    const t: any = mapSnapshot(snap({ items: [{ ...BASE.items[0], title: null }] }));
    expect(t.items[0].title).toBe("Product description unavailable");
  });
  it("falls back to the order id when there is no external order id", () => {
    expect((mapSnapshot(snap({ order: { externalOrderId: null, shipByAt: null } })) as any).orderNumber).toBe(BASE.fulfillmentOrderId);
  });
  it("exposes packageId and packageRowVersion for measurements and seal", () => {
    const t: any = mapSnapshot(LABEL_VERIFIED);
    expect(t.packageId).toBe("66666666-6666-4666-8666-666666666666"); expect(t.packageRowVersion).toBe(4);
    expect(mapSnapshot(snap())).not.toHaveProperty("packageId");
  });
  it("refuses unknown statuses rather than mapping them to CONTENTS", () => {
    expect(() => mapSnapshot(snap({ status: "FUTURE_UNKNOWN" }))).toThrow(expect.objectContaining({ code: "PACKSHIP_STATUS_UNKNOWN" }));
  });
  it("refuses a pre-0.2.1 snapshot (e.g. an old stored replay) instead of guessing the missing fields", () => {
    const { snapshotVersion, ...old } = BASE;
    expect(() => mapSnapshot(old)).toThrow(expect.objectContaining({ code: "PACKSHIP_SNAPSHOT_VERSION_UNSUPPORTED" }));
  });
  it("refuses missing facility or order metadata, and a station outside the facility", () => {
    expect(() => mapSnapshot(snap({ facility: null }))).toThrow(expect.objectContaining({ code: "PACKSHIP_METADATA_MISSING" }));
    expect(() => mapSnapshot(snap({ order: null }))).toThrow(expect.objectContaining({ code: "PACKSHIP_METADATA_MISSING" }));
    expect(() => mapSnapshot(snap({ station: null }))).toThrow(expect.objectContaining({ code: "PACKSHIP_STATION_MISMATCH" }));
    expect((mapSnapshot(snap({ assignedStationId: null, station: null })) as any).stationCode).toBe("UNASSIGNED");
  });
  it("refuses malformed evidence counts", () => {
    expect(() => mapSnapshot(snap({ evidence: { ...BASE.evidence, pending: -1 } }))).toThrow(expect.objectContaining({ code: "PACKSHIP_SNAPSHOT_INVALID" }));
  });
  it("EVIDENCE passes only with requirements all accepted and integrity verified", () => {
    const ok = { requirementCount: 1, required: 1, accepted: 1, pending: 0, rejected: 0, integrityVerified: true };
    expect(gate(mapSnapshot(snap({ evidence: ok, blockers: [] })), "EVIDENCE")).toBe("PASS");
    expect(gate(mapSnapshot(snap({ evidence: { ...ok, integrityVerified: false }, blockers: [] })), "EVIDENCE")).toBe("PENDING");
    expect(gate(mapSnapshot(snap({ evidence: { ...ok, rejected: 1 }, blockers: [] })), "EVIDENCE")).toBe("FAIL");
    expect(gate(mapSnapshot(snap({ blockers: [] })), "EVIDENCE")).toBe("PENDING"); // no requirements, before the step
    expect(gate(mapSnapshot(snap({ evidence: { ...ok, integrityVerified: false }, blockers: ["EVIDENCE_PENDING"] })), "EVIDENCE")).toBe("PENDING");
  });
  it("EVIDENCE with no requirements passes once the task reached the evidence step (as the database allows)", () => {
    expect(gate(mapSnapshot(snap({ status: "EVIDENCE_PENDING", blockers: [] })), "EVIDENCE")).toBe("PASS");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED }), "EVIDENCE")).toBe("PASS"); // LABEL_VERIFIED fixture has none
  });
  it("a fully verified LABEL_VERIFIED task passes every blocking gate (PR #13 allBlockingGatesPass → outbound step)", () => {
    const t: any = mapSnapshot(LABEL_VERIFIED);
    expect(t.completionGates.every((g: any) => !g.blocking || g.state === "PASS")).toBe(true);
    expect(t.carrierLabel.status).toBe("SCAN_VERIFIED");
  });
  it("OUTBOUND passes exactly when stage_outbound_v2's precondition holds", () => {
    expect(gate(mapSnapshot(LABEL_VERIFIED), "OUTBOUND")).toBe("PASS");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, claim: { ...BASE.claim, heldBySession: false } }), "OUTBOUND")).toBe("PENDING");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, claim: null }), "OUTBOUND")).toBe("PENDING");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, blockers: ["ITEM_ON_HOLD"] }), "OUTBOUND")).toBe("FAIL");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, status: "PACKED" }), "OUTBOUND")).toBe("PENDING");
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, status: "OUTBOUND_STAGED", claim: null }), "OUTBOUND")).toBe("PASS");
  });
  it("a fresh task (the production response's blockers) shows no FAIL gate: not done yet is PENDING", () => {
    const fresh = snap({ status: "READY", claim: null, blockers: ["SOURCE_UNVERIFIED", "ITEMS_UNVERIFIED", "PACKAGE_MISSING"] });
    const t: any = mapSnapshot(fresh);
    expect(t.completionGates.map((g: any) => g.state)).toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PENDING"]);
    const measuring: any = mapSnapshot(snap({ status: "MEASURING", blockers: ["WEIGHT_MISSING", "DIMENSIONS_MISSING", "EVIDENCE_PENDING"] }));
    expect(measuring.completionGates.some((g: any) => g.state === "FAIL")).toBe(false);
  });
  it("real problems are FAIL: item on hold / not packable fail CONTENTS and OUTBOUND", () => {
    for (const b of ["ITEM_ON_HOLD", "ITEM_NOT_PACKABLE"]) {
      const t: any = mapSnapshot({ ...LABEL_VERIFIED, blockers: [b] });
      expect(gate(t, "CONTENTS")).toBe("FAIL"); expect(gate(t, "OUTBOUND")).toBe("FAIL");
    }
  });
  it("an unknown blocker code is treated as a problem (OUTBOUND FAIL), never as harmless", () => {
    expect(gate(mapSnapshot({ ...LABEL_VERIFIED, blockers: ["SOMETHING_NEW"] }), "OUTBOUND")).toBe("FAIL");
  });
  it("an open exception is a problem: OUTBOUND FAIL even before label", () => {
    expect(gate(mapSnapshot(snap({ blockers: ["ITEMS_UNVERIFIED", "EXCEPTION_OPEN"] })), "OUTBOUND")).toBe("FAIL");
  });
  it("an open exception turns every PASS into FAIL", () => {
    const t: any = mapSnapshot({ ...LABEL_VERIFIED, blockers: ["EXCEPTION_OPEN"] });
    expect(t.completionGates.every((g: any) => g.state !== "PASS")).toBe(true);
  });
  it("PRINTED only when the gateway reported the label job printed", () => {
    const printing = { ...LABEL_VERIFIED, status: "PRINTING" };
    expect((mapSnapshot({ ...printing, printJob: { ...LABEL_VERIFIED.printJob, status: "PRINTED" } }) as any).carrierLabel.status).toBe("PRINTED");
    expect((mapSnapshot({ ...printing, printJob: { ...LABEL_VERIFIED.printJob, status: "QUEUED" } }) as any).carrierLabel.status).toBe("PRINT_QUEUED");
    expect((mapSnapshot({ ...printing, status: "PACKED", printJob: { ...LABEL_VERIFIED.printJob, status: "FAILED" } }) as any).carrierLabel.status).toBe("LABEL_PURCHASED");
    expect((mapSnapshot({ ...printing, status: "PACKED", printJob: { ...LABEL_VERIFIED.printJob, status: "VERIFIED" } }) as any).carrierLabel.status).toBe("PRINTED");
    expect((mapSnapshot({ ...printing, printJob: null }) as any).carrierLabel.status).toBe("PRINTING");
    expect((mapSnapshot(LABEL_VERIFIED) as any).carrierLabel.status).toBe("SCAN_VERIFIED");
  });
});

describe("V0.2.3 control fields (claim, taskStatus, manualWeightApproval)", () => {
  const D = "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8";
  it("passes the database status and the claim as the database reports it", () => {
    const t: any = mapSnapshot(snap({ status: "READY", claim: null }));
    expect(t.taskStatus).toBe("READY"); expect(t.claim).toBeNull();
    const held: any = mapSnapshot(snap());
    expect(held.claim).toEqual({ heldBySession: true, expired: false, expiresAt: "2026-11-17T10:00:00Z" });
    const other: any = mapSnapshot(snap({ claim: { ...BASE.claim, heldBySession: false } }));
    expect(other.claim.heldBySession).toBe(false);
    const missing: any = mapSnapshot(snap({ claim: { expiresAt: "x" } }));   // absent flags are never read as true
    expect(missing.claim).toEqual({ heldBySession: false, expired: false, expiresAt: "x" });
  });
  it("manualWeightApproval: a well-formed approval is passed on; absent (pre-916) or malformed is null", () => {
    expect((mapSnapshot(snap()) as any).manualWeightApproval).toBeNull();
    expect((mapSnapshot(snap({ manualWeightApproval: null })) as any).manualWeightApproval).toBeNull();
    expect((mapSnapshot(snap({ manualWeightApproval: { overrideDecisionId: "not-a-uuid" } })) as any).manualWeightApproval).toBeNull();
    expect((mapSnapshot(snap({ manualWeightApproval: { overrideDecisionId: D, decidedAt: "2026-11-18T07:00:00Z", expiresAt: null, reasonCode: "NO_SCALE" } })) as any)
      .manualWeightApproval).toEqual({ overrideDecisionId: D, decidedAt: "2026-11-18T07:00:00Z", expiresAt: null });
  });
});
