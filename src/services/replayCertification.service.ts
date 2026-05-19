import { sha256 } from './hashStable';
import type { ReplayInputSnapshot, ReplayResult } from '../contracts/capitalSafety.types';

export interface ReplayCertificationOptions {
  recompute: (inputJson: unknown) => unknown;
}

export function certifyReplay(
  snapshots: ReplayInputSnapshot[],
  options: ReplayCertificationOptions,
): ReplayResult[] {
  return snapshots.map((snapshot) => certifyOne(snapshot, options));
}

export function certifyOne(
  snapshot: ReplayInputSnapshot,
  options: ReplayCertificationOptions,
): ReplayResult {
  const actualOutput = options.recompute(snapshot.inputJson);
  const inputHash = sha256({
    inputJson: snapshot.inputJson,
    scoringVersion: snapshot.scoringVersion,
    policyVersion: snapshot.policyVersion,
  });
  const expectedOutputHash = sha256(snapshot.outputJson);
  const actualOutputHash = sha256(actualOutput);

  const passed = expectedOutputHash === actualOutputHash;

  return {
    entityKey: snapshot.entityKey,
    passed,
    inputHash,
    expectedOutputHash,
    actualOutputHash,
    driftReason: passed ? undefined : 'OUTPUT_HASH_MISMATCH',
  };
}
