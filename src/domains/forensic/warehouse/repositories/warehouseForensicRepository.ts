import type { Pool } from 'pg';
import { requireWarehousePrincipalContext, type ForensicPrincipal } from '../../auth/forensicPrincipal';
import type {
  GateEvaluation,
  WarehouseEvidenceSession,
  WarehouseWorkflow,
} from '../models/warehouseForensicTypes';

const mapSession = (row: Record<string, unknown>): WarehouseEvidenceSession => ({
  warehouseEvidenceSessionId: String(row.warehouse_evidence_session_id),
  chainId: String(row.chain_id),
  tenantKey: String(row.tenant_key),
  workflowType: String(row.workflow_type) as WarehouseWorkflow,
  status: String(row.status),
  continuityStatus: String(row.continuity_status),
  openedAt: new Date(String(row.opened_at)).toISOString(),
  completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
});

export class WarehouseForensicRepository {
  constructor(private readonly pool: Pool) {}

  async startSession(input: {
    principal: ForensicPrincipal;
    chainId: string;
    workflowType: WarehouseWorkflow;
    linkType: string;
    linkRefs: Record<string, string | undefined>;
    idempotencyKey: string;
    correlationId: string;
    processRunId: string;
    metadata?: Record<string, unknown>;
  }): Promise<WarehouseEvidenceSession> {
    const p = input.principal;
    const w = requireWarehousePrincipalContext(p);
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7b_start_session(
        $1::uuid,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::uuid,
        $10::uuid,$11::uuid,$12::jsonb,$13::forensic.event_actor_type,$14,
        $15,$16::uuid,$17::uuid,$18::jsonb
      )`,
      [
        input.chainId,p.tenantKey,input.workflowType,input.linkType,w.facilityId,
        w.stationId ?? null,w.deviceId,w.warehouseDeviceSessionId,w.warehouseAuthSessionId,
        w.warehouseUserId,w.warehouseEmployeeId,JSON.stringify(input.linkRefs),
        p.actorType,p.actorId,input.idempotencyKey,input.correlationId,
        input.processRunId,JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapSession(rows[0] as Record<string, unknown>);
  }

  async getSession(sessionId: string, tenantKey: string): Promise<WarehouseEvidenceSession | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.warehouse_evidence_sessions
       WHERE warehouse_evidence_session_id=$1::uuid AND tenant_key=$2`,
      [sessionId,tenantKey],
    );
    return rows[0] ? mapSession(rows[0] as Record<string, unknown>) : null;
  }

  async listSessionEvidence(sessionId: string, tenantKey: string) {
    const { rows } = await this.pool.query(
      `SELECT l.warehouse_artifact_link_id,l.artifact_id,l.evidence_role,l.sequence_no,
              l.accepted_snapshot_sha256,l.accepted_storage_version_id,l.linked_at
       FROM forensic.warehouse_artifact_links l
       JOIN forensic.warehouse_evidence_sessions s
         ON s.warehouse_evidence_session_id=l.warehouse_evidence_session_id
       WHERE l.warehouse_evidence_session_id=$1::uuid AND s.tenant_key=$2
       ORDER BY l.evidence_role,l.sequence_no`,
      [sessionId,tenantKey],
    );
    return rows;
  }

  async linkArtifact(args: {
    principal: ForensicPrincipal; sessionId: string; artifactId: string; evidenceRole: string;
    sourceSchema?: string; sourceTable?: string; sourceRecordId?: string;
    warehouseMediaAssetId?: string; sequenceNo: number; idempotencyKey: string;
    correlationId: string; processRunId: string; metadata?: Record<string, unknown>;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_link_accepted_artifact(
       $1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,
       $11::forensic.event_actor_type,$12,$13,$14::uuid,$15::uuid,$16::jsonb)`,
      [args.sessionId,p.tenantKey,args.artifactId,args.evidenceRole,
       args.sourceSchema??null,args.sourceTable??null,args.sourceRecordId??null,
       args.warehouseMediaAssetId??null,args.sequenceNo,w.warehouseUserId,p.actorType,
       p.actorId,args.idempotencyKey,args.correlationId,args.processRunId,
       JSON.stringify(args.metadata??{})],
    );
    return rows[0];
  }

  async recordCondition(args: {
    principal: ForensicPrincipal; sessionId:string; itemId:string; inspectionId?:string;
    conditionStage:string; conditionGrade?:string; severity:string; defectCodes:string[];
    narrative:string; artifactLinkIds:string[]; attestedAt:string; idempotencyKey:string;
    correlationId:string; processRunId:string;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_record_condition_attestation(
       $1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8::text[],$9,$10::uuid[],
       $11::uuid,$12::uuid,$13::timestamptz,$14::forensic.event_actor_type,$15,
       $16,$17::uuid,$18::uuid)`,
      [args.sessionId,p.tenantKey,args.itemId,args.inspectionId??null,
       args.conditionStage,args.conditionGrade??null,args.severity,args.defectCodes,
       args.narrative,args.artifactLinkIds,w.warehouseUserId,w.deviceId,args.attestedAt,
       p.actorType,p.actorId,args.idempotencyKey,args.correlationId,args.processRunId],
    );
    return rows[0];
  }

  async applySeal(args: {
    principal: ForensicPrincipal; sessionId:string; packingTaskId:string; packageId:string;
    sealCodeHmac:string; maskedSealCode:string; sealType:string; artifactLinkId?:string;
    occurredAt:string; idempotencyKey:string; correlationId:string; processRunId:string;
    metadata?:Record<string,unknown>;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_apply_tamper_seal(
       $1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9::uuid,$10::uuid,
       $11::timestamptz,$12::forensic.event_actor_type,$13,$14,$15::uuid,$16::uuid,$17::jsonb)`,
      [args.sessionId,p.tenantKey,args.packingTaskId,args.packageId,args.sealCodeHmac,
       args.maskedSealCode,args.sealType,w.warehouseUserId,w.deviceId,
       args.artifactLinkId??null,args.occurredAt,p.actorType,p.actorId,
       args.idempotencyKey,args.correlationId,args.processRunId,
       JSON.stringify(args.metadata??{})],
    );
    return rows[0];
  }

  async recordPackingAttestation(args: {
    principal:ForensicPrincipal;sessionId:string;packingTaskId:string;packageId:string;
    itemId:string;packingTaskItemId:string;idempotencyKey:string;correlationId:string;
    processRunId:string;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_record_packing_attestation(
       $1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
       $8::forensic.event_actor_type,$9,$10,$11::uuid,$12::uuid)`,
      [args.sessionId,p.tenantKey,args.packingTaskId,args.packageId,args.itemId,
       args.packingTaskItemId,w.warehouseUserId,p.actorType,p.actorId,
       args.idempotencyKey,args.correlationId,args.processRunId],
    );
    return rows[0];
  }

  async recordSupervisorDecision(args: {
    principal:ForensicPrincipal;sessionId:string;decisionType:string;decision:string;
    warehouseOverrideId?:string;reason:string;supersedesDecisionId?:string;
    idempotencyKey:string;correlationId:string;processRunId:string;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_record_supervisor_decision(
       $1::uuid,$2,$3,$4,$5::uuid,$6,$7::uuid,$8::uuid,
       $9::forensic.event_actor_type,$10,$11,$12::uuid,$13::uuid)`,
      [args.sessionId,p.tenantKey,args.decisionType,args.decision,
       args.warehouseOverrideId??null,args.reason,w.warehouseUserId,
       args.supersedesDecisionId??null,p.actorType,p.actorId,args.idempotencyKey,
       args.correlationId,args.processRunId],
    );
    return rows[0];
  }

  async setContinuityException(args:{
    principal:ForensicPrincipal;sessionId:string;reason:string;details:Record<string,unknown>;
    idempotencyKey:string;correlationId:string;processRunId:string;
  }) {
    const p=args.principal;
    const w=requireWarehousePrincipalContext(p);
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7b_set_continuity_exception(
       $1::uuid,$2,$3,$4::jsonb,$5::forensic.event_actor_type,$6,$7,$8::uuid,$9::uuid)`,
      [args.sessionId,p.tenantKey,args.reason,JSON.stringify(args.details),
       p.actorType,p.actorId,args.idempotencyKey,args.correlationId,args.processRunId],
    );
    return mapSession(rows[0] as Record<string,unknown>);
  }

  async evaluateGate(input: {
    sessionId: string; principal: ForensicPrincipal; processRunId: string; correlationId: string;
  }): Promise<GateEvaluation> {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7b_evaluate_gate(
        $1::uuid,$2,$3::forensic.event_actor_type,$4,$5::uuid,$6::uuid
      )`,
      [input.sessionId,input.principal.tenantKey,input.principal.actorType,
       input.principal.actorId,input.processRunId,input.correlationId],
    );
    const row = rows[0] as Record<string, unknown>;
    return {
      warehouseGateEvaluationId: String(row.warehouse_gate_evaluation_id),
      result: String(row.result) as GateEvaluation['result'],
      blockers: (row.blockers_json as unknown[]) ?? [],
      evidenceSnapshot: (row.evidence_snapshot_json as Record<string, unknown>) ?? {},
    };
  }
}
