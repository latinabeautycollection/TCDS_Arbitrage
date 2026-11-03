import { afterEach, describe, expect, it, vi } from "vitest";

import { DOMAIN6_2B_CERTIFICATION_POLICY } from "../../src/lib/scanning/capture/BarcodeCaptureCapability";
import {
  INTERIM_LOOKUP_CAPTURE_POLICY,
  INTERIM_LOOKUP_WORKFLOWS,
} from "../../src/lib/scanning/workflow/policy/InterimLookupCapturePolicy";
import { INVENTORY_CAPTURE_POLICY } from "../../src/lib/scanning/workflow/policy/workflowCapturePolicies";
import { inventoryCameraScanEnabled } from "../../src/lib/scanning/workflow/bindings/inventoryWorkflow";
import type { WarehouseCaptureIntent } from "../../src/lib/scanning/workflow/contracts/WarehouseCaptureIntent";

const intent: WarehouseCaptureIntent = { intent: "ITEM_ID", mode: "SINGLE", allowedSymbologies: ["CODE128"], allowManualFallback: true };
const ask = (workflow: string) =>
  INTERIM_LOOKUP_CAPTURE_POLICY.resolveIntentPolicy(intent, { workflow, workflowEntityId: "E", workflowStep: "S" });

afterEach(() => vi.unstubAllEnvs());

describe("6.2D interim lookup policy", () => {
  it("gives Inventory the 6.2B certification profile", async () => {
    await expect(ask("INVENTORY")).resolves.toBe(DOMAIN6_2B_CERTIFICATION_POLICY);
  });

  it.each(["RECEIVING", "PUTAWAY", "PICKING", "PACKING", "OUTBOUND", "RETURNS"])(
    "refuses %s, so no workflow that changes data can use it",
    async (workflow) => {
      await expect(ask(workflow)).rejects.toThrow("INTERIM_POLICY_NOT_PERMITTED");
    },
  );

  it("lists Inventory alone until Returns is confirmed to change nothing", () => {
    expect([...INTERIM_LOOKUP_WORKFLOWS]).toEqual(["INVENTORY"]);
  });

  it("is bound to Inventory explicitly, as one switchable line", () => {
    expect(INVENTORY_CAPTURE_POLICY).toBe(INTERIM_LOOKUP_CAPTURE_POLICY);
  });
});

describe("6.2D Inventory camera flag", () => {
  it("is off when the flag is unset", () => {
    vi.stubEnv("VITE_SCANDIT_WORKFLOW_INVENTORY", undefined as unknown as string);
    expect(inventoryCameraScanEnabled()).toBe(false);
  });

  it.each(["false", "TRUE", "1", "yes", ""])("is off for %j", (value) => {
    vi.stubEnv("VITE_SCANDIT_WORKFLOW_INVENTORY", value);
    expect(inventoryCameraScanEnabled()).toBe(false);
  });

  it('is on only for exactly "true"', () => {
    vi.stubEnv("VITE_SCANDIT_WORKFLOW_INVENTORY", "true");
    expect(inventoryCameraScanEnabled()).toBe(true);
  });
});
