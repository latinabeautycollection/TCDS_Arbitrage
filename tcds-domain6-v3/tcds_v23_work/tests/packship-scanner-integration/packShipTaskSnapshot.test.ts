import { describe, expect, it } from "vitest";
import { chooseNewestPackShipTaskSnapshot, selectPackShipTaskSnapshot } from "../../src/features/packShip/scanning/packShipTaskSnapshot";
import type { PackShipTask } from "../../src/features/packShip/types/packShipTypes";

const base = { taskId: "T1", rowVersion: 10, lastUpdatedAt: "2026-11-12T10:00:00Z" } as PackShipTask;

describe("Pack/Ship authoritative snapshot ordering", () => {
  it("rejects an older rowVersion arriving late", () => {
    const older = { ...base, rowVersion: 9, lastUpdatedAt: "2026-11-12T11:00:00Z" };
    expect(chooseNewestPackShipTaskSnapshot(base, older)).toBe(base);
  });

  it("accepts a higher rowVersion", () => {
    const newer = { ...base, rowVersion: 11, lastUpdatedAt: "2026-11-12T09:00:00Z" };
    expect(chooseNewestPackShipTaskSnapshot(base, newer)).toBe(newer);
  });

  it("uses server lastUpdatedAt only to break an equal-version tie", () => {
    const newer = { ...base, lastUpdatedAt: "2026-11-12T10:01:00Z" };
    expect(chooseNewestPackShipTaskSnapshot(base, newer)).toBe(newer);
  });

  it("prevents a late response for a previous route task from entering UI state", () => {
    const other = { ...base, taskId: "T0", rowVersion: 99 } as PackShipTask;
    expect(selectPackShipTaskSnapshot(base, other, "T1")).toEqual({
      accepted: false,
      reason: "CROSS_TASK_RESPONSE_BLOCKED",
      task: base,
    });
  });

  it("models stale load-after-scan ordering by retaining the higher rowVersion", () => {
    const scanResponse = { ...base, rowVersion: 11, lastUpdatedAt: "2026-11-12T10:01:00Z" } as PackShipTask;
    const olderLoad = { ...base, rowVersion: 10, lastUpdatedAt: "2026-11-12T10:02:00Z" } as PackShipTask;
    const afterScan = selectPackShipTaskSnapshot(base, scanResponse, "T1");
    expect(afterScan.accepted).toBe(true);
    const afterLateLoad = selectPackShipTaskSnapshot(afterScan.task, olderLoad, "T1");
    expect(afterLateLoad.accepted && afterLateLoad.task.rowVersion).toBe(11);
  });
});
