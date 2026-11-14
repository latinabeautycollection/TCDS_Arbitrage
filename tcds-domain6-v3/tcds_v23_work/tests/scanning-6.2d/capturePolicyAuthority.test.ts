import { describe, expect, it, vi } from "vitest";

import {
  CertifiedCapturePolicyAuthority,
  captureContextFor,
} from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";
import { CapturePolicyError } from "../../src/lib/scanning/policy/CapturePolicyError";
import type { WarehouseCaptureIntent } from "../../src/lib/scanning/workflow/contracts/WarehouseCaptureIntent";
import { authorityFixture } from "../scanning-6.2c/fixtures";

const intent = (value: WarehouseCaptureIntent["intent"]): WarehouseCaptureIntent => ({
  intent: value,
  mode: "SINGLE",
  allowedSymbologies: ["CODE128"],
  allowManualFallback: false,
});

describe("6.2D uses the certified 6.2C capture policy", () => {
  it("resolves a pick item scan through 6.2C", async () => {
    const authority = new CertifiedCapturePolicyAuthority({ load: async () => authorityFixture() });

    const policy = await authority.resolveIntentPolicy(intent("ITEM_ID"), {
      workflow: "PICKING",
      workflowEntityId: "T1",
      workflowStep: "SCAN_ITEM",
    });

    expect(policy.lineage).toMatchObject({ policySource: "6.2C_VALIDATED_POLICY", profileId: "PICK_ITEM" });
    expect(policy.symbologies.length).toBeGreaterThan(0);
  });

  it("fails closed when 6.2C rejects the Warehouse Control snapshot", async () => {
    const authority = new CertifiedCapturePolicyAuthority({
      load: async () => authorityFixture({ scannerMode: "HID_KEYBOARD" }),
    });

    await expect(
      authority.resolveIntentPolicy(intent("ITEM_ID"), { workflow: "PICKING", workflowEntityId: "T1", workflowStep: "SCAN_ITEM" }),
    ).rejects.toBeInstanceOf(CapturePolicyError);
  });

  it("fails closed, without loading anything, for a scan with no certified context", async () => {
    const load = vi.fn(async () => authorityFixture());
    const authority = new CertifiedCapturePolicyAuthority({ load });

    await expect(
      authority.resolveIntentPolicy(intent("TOTE_ID"), { workflow: "PACKING", workflowEntityId: "P1", workflowStep: "PACK_SOURCE" }),
    ).rejects.toThrow("CAPTURE_POLICY_CONTEXT_UNMAPPED");
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ["PACKING", "PACK_SOURCE", "SOURCE_ID", "PACK_SOURCE"],
    ["OUTBOUND", "PACK_OUTBOUND_LOCATION", "OUTBOUND_LOCATION", "PACK_OUTBOUND_LOCATION"],
  ] as const)("resolves %s %s %s through 6.2C as %s", async (workflow, workflowStep, value, contextId) => {
    const authority = new CertifiedCapturePolicyAuthority({ load: async () => authorityFixture() });

    const policy = await authority.resolveIntentPolicy(intent(value), { workflow, workflowEntityId: "P1", workflowStep });

    expect(policy.lineage).toMatchObject({ policySource: "6.2C_VALIDATED_POLICY", profileId: contextId });
    expect(policy.symbologies).toEqual(["CODE128", "QR"]);
  });

  it.each([
    ["RECEIVING", "RECEIVE", "PACKAGE_ID", "RECEIVING_PACKAGE"],
    ["RECEIVING", "RECEIVE", "IMEI", "RECEIVING_SERIAL"],
    ["PUTAWAY", "SCAN", "LOCATION_ID", "PUTAWAY_LOCATION"],
    ["PICKING", "SCAN", "TOTE_ID", "PICK_DESTINATION"],
    ["PACKING", "PACK_TRACKING_LABEL", "TRACKING_NUMBER", "TRACKING_LABEL"],
    ["PACKING", "PACK_PACKAGE", "PACKAGE_ID", "PACK_PACKAGE"],
    ["PACKING", "PACK_VERIFY_LABEL", "TRACKING_NUMBER", null],
    ["INVENTORY", "LOOKUP", "ITEM_ID", "INVENTORY_LOOKUP"],
    ["RETURNS", "RESOLVE", "SERIAL", "RETURN_SERIAL"],
    ["PACKING", "PACK_SOURCE", "SOURCE_ID", "PACK_SOURCE"],
    ["OUTBOUND", "PACK_OUTBOUND_LOCATION", "OUTBOUND_LOCATION", "PACK_OUTBOUND_LOCATION"],
    ["OUTBOUND", "STAGE", "OUTBOUND_LOCATION", null],
    ["OUTBOUND", "PACK_OUTBOUND_LOCATION", "LOCATION_ID", null],
    ["PACKING", "PACK_SOURCE", "TOTE_ID", null],
  ] as const)("%s %s %s maps to %s", (workflow, step, value, expected) => {
    expect(captureContextFor(workflow, step, value)).toBe(expected);
  });
});
