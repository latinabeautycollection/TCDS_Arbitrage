import type { PackShipTask } from "../types/packShipTypes";

function millis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

/**
 * Prevents an older asynchronous Pack/Ship response from overwriting a newer authoritative
 * task snapshot already rendered by the screen. This is ordering protection only; it does
 * not manufacture warehouse truth or resolve conflicts in the browser.
 */
export function chooseNewestPackShipTaskSnapshot(
  current: PackShipTask | null,
  incoming: PackShipTask,
): PackShipTask {
  if (!current) return incoming;
  if (current.taskId !== incoming.taskId) return incoming;

  if (incoming.rowVersion > current.rowVersion) return incoming;
  if (incoming.rowVersion < current.rowVersion) return current;

  return millis(incoming.lastUpdatedAt) >= millis(current.lastUpdatedAt)
    ? incoming
    : current;
}

export type PackShipSnapshotSelection =
  | { accepted: true; task: PackShipTask }
  | { accepted: false; reason: "CROSS_TASK_RESPONSE_BLOCKED"; task: PackShipTask | null };

/**
 * One monotonic ingress gate for every task response: initial load, manual mutation,
 * scanner mutation and refresh. A response for another route task never becomes UI truth.
 */
export function selectPackShipTaskSnapshot(
  current: PackShipTask | null,
  incoming: PackShipTask,
  expectedTaskId: string,
): PackShipSnapshotSelection {
  if (!expectedTaskId || incoming.taskId !== expectedTaskId) {
    return { accepted: false, reason: "CROSS_TASK_RESPONSE_BLOCKED", task: current };
  }
  return { accepted: true, task: chooseNewestPackShipTaskSnapshot(current, incoming) };
}
