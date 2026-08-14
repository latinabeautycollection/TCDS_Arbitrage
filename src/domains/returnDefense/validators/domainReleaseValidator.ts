
import { z } from "zod";

export const releaseDecisionSchema = z.object({
  packetId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT", "CONDITIONAL"]),
  reason: z.string().min(20).max(4000),
});

export const deploymentCheckpointSchema = z.object({
  checkpointCode: z.string().min(3).max(120),
  status: z.enum(["PASS", "FAIL", "WAIVED"]),
  actualResult: z.record(z.string(), z.unknown()),
});
