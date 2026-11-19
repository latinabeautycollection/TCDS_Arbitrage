import { describe, expect, it } from "vitest";
import { canChooseBox, canMeasure, canSeal, checkMeasurements, claimView } from "../../src/features/packShip/controls/packShipControlState";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

const HELD = { heldBySession: true, expired: false, expiresAt: "2026-11-18T10:00:00Z" };
const PASS = (code: string) => ({ code, label: code, state: "PASS" as const, blocking: true });
const t = (o: Partial<PackShipTask>) => ({ taskId: "T1", rowVersion: 3, sealed: false, completionGates: [], ...o }) as PackShipTask;

describe("claimView mirrors packship_claim_task_v2", () => {
  it.each<[string, Partial<PackShipTask>, string]>([
    ["no claim", { taskStatus: "READY", claim: null }, "UNCLAIMED"],
    ["held by this session", { taskStatus: "CLAIMED", claim: HELD }, "HELD"],
    ["held by another session", { taskStatus: "CLAIMED", claim: { ...HELD, heldBySession: false } }, "HELD_BY_OTHER"],
    ["expired (takeover)", { taskStatus: "PACKING", claim: { ...HELD, heldBySession: false, expired: true } }, "EXPIRED"],
    ["staged (not claimable)", { taskStatus: "OUTBOUND_STAGED", claim: null }, "NOT_CLAIMABLE"],
    ["status missing (old route): no control", { claim: null }, "NOT_CLAIMABLE"],
  ])("%s", (_n, o, kind) => expect(claimView(t(o)).kind).toBe(kind));
});

describe("which controls open", () => {
  it("box: PACKING + held + no package only", () => {
    expect(canChooseBox(t({ taskStatus: "PACKING", claim: HELD }))).toBe(true);
    expect(canChooseBox(t({ taskStatus: "PACKING", claim: { ...HELD, heldBySession: false } }))).toBe(false);
    expect(canChooseBox(t({ taskStatus: "CONTENTS_VERIFYING", claim: HELD }))).toBe(false);
    expect(canChooseBox(t({ taskStatus: "PACKING", claim: HELD, packageId: "P" }))).toBe(false);
  });
  it("measurements: MEASURING or EVIDENCE_PENDING, held, package id + row version", () => {
    const base = { claim: HELD, packageId: "P", packageRowVersion: 2 };
    expect(canMeasure(t({ ...base, taskStatus: "MEASURING" }))).toBe(true);
    expect(canMeasure(t({ ...base, taskStatus: "EVIDENCE_PENDING" }))).toBe(true);
    expect(canMeasure(t({ ...base, taskStatus: "PACKED" }))).toBe(false);
    expect(canMeasure(t({ ...base, taskStatus: "MEASURING", packageRowVersion: undefined }))).toBe(false);
    expect(canMeasure(t({ ...base, taskStatus: "MEASURING", claim: null }))).toBe(false);
  });
  it("seal: EVIDENCE_PENDING, held, package, and contents + measurements + evidence all PASS", () => {
    const base = { taskStatus: "EVIDENCE_PENDING", claim: HELD, packageId: "P", packageRowVersion: 2 };
    const gates = [PASS("CONTENTS"), PASS("MEASUREMENTS"), PASS("EVIDENCE"), { ...PASS("LABEL"), state: "PENDING" as const }];
    expect(canSeal(t({ ...base, completionGates: gates }))).toBe(true);
    expect(canSeal(t({ ...base, completionGates: [PASS("CONTENTS"), PASS("MEASUREMENTS"), { ...PASS("EVIDENCE"), state: "PENDING" }] }))).toBe(false);
    expect(canSeal(t({ ...base, completionGates: [PASS("CONTENTS"), PASS("MEASUREMENTS")] }))).toBe(false); // a missing gate is not a pass
    expect(canSeal(t({ ...base, completionGates: gates, taskStatus: "MEASURING" }))).toBe(false);
    expect(canSeal(t({ ...base, completionGates: gates, sealed: true }))).toBe(false);
  });
});

describe("checkMeasurements: the database's limits, in lb + oz and inches", () => {
  const d = (o: object) => ({ pounds: "", ounces: "", lengthIn: "10", widthIn: "8", heightIn: "4", ...o });
  it("1 lb 4 oz → 20 oz; dimensions as numbers", () =>
    expect(checkMeasurements(d({ pounds: "1", ounces: "4" }))).toEqual({ ok: true, value: { weightOz: 20, lengthIn: 10, widthIn: 8, heightIn: 4 } }));
  it("ounces only (no pounds) may be 16 or more", () => expect(checkMeasurements(d({ ounces: "20.5" }))).toMatchObject({ ok: true, value: { weightOz: 20.5 } }));
  it.each<[string, object, string]>([
    ["zero weight", { pounds: "0", ounces: "0" }, "weight"],
    ["no weight", {}, "weight"],
    ["16 oz alongside pounds", { pounds: "1", ounces: "16" }, "weight"],
    ["over 2400 oz", { pounds: "151" }, "weight"],
    ["negative / text", { pounds: "-1" }, "weight"],
    ["length 0", { pounds: "1", lengthIn: "0" }, "length"],
    ["width over 240", { pounds: "1", widthIn: "241" }, "width"],
    ["height not a number", { pounds: "1", heightIn: "4in" }, "height"],
  ])("refuses %s", (_n, o, field) => expect(checkMeasurements(d(o))).toEqual({ ok: false, field }));
});
