import { z } from "zod";
import { gateStages } from "../contracts/preventionControlPlane";

export const featureSnapshotSchema = z.object({
  passportId: z.string().uuid(),
  passportVersionId: z.string().uuid(),
  gateStage: z.enum(gateStages),
  featureSchemaVersion: z.string().min(1).max(120),
  features: z.record(z.string(), z.unknown()),
  sourceDigest: z.record(z.string(), z.unknown()),
  policyVersionId: z.string().uuid(),
  modelVersionId: z.string().uuid().nullable().optional(),
  freshForSeconds: z.number().int().positive().max(2_592_000),
});

export const riskAssessmentSchema = z.object({
  featureSnapshotId: z.string().uuid(),
  riskScore: z.number().min(0).max(100),
  returnProbability: z.number().min(0).max(1).nullable().optional(),
  disputeProbability: z.number().min(0).max(1).nullable().optional(),
  fraudProbability: z.number().min(0).max(1).nullable().optional(),
  expectedLossUsd: z.number().nonnegative(),
  expectedLaborMinutes: z.number().nonnegative(),
  defensibilityScore: z.number().min(0).max(100).nullable().optional(),
  executionIntegrityScore: z.number().min(0).max(100).nullable().optional(),
  evidenceReliabilityScore: z.number().min(0).max(100).nullable().optional(),
  confidenceScore: z.number().min(0).max(100),
  rulesetVersion: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()),
  reasonCodes: z.array(z.string().min(1).max(96)).max(100),
});

export const preventionDecisionSchema = z.object({
  riskAssessmentId: z.string().uuid(),
  gateStatus: z.enum(["ALLOW","ALLOW_WITH_CONTROLS","REVIEW","HOLD","BLOCK"]),
  reviewLevel: z.enum(["AUTO","AI_ASSISTED","SUPERVISOR","EXECUTIVE"]),
  decisionDeadline: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()),
  reasonCodes: z.array(z.string().min(1).max(96)).max(100),
});
