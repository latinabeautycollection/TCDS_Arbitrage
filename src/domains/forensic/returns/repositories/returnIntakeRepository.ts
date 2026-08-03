import type { Pool } from 'pg';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';

export interface OpenReturnInput {
  chainId: string; returnCaseId: string; returnSessionId: string;
  outboundPackageId?: string; shippingCustodyLinkId?: string; arbShipmentId?: string;
  idempotencyKey: string; metadata?: Readonly<Record<string, unknown>>;
}
export class ReturnIntakeRepository {
  constructor(private readonly pool: Pool) {}

  async open(p: ReturnPrincipal,input: OpenReturnInput,runId: string,correlationId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7d1_open_return_r2(
       $1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::uuid,$9::uuid,$10::uuid,
       $11::uuid,$12::uuid,$13::uuid,$14::forensic.event_actor_type,$15,$16,$17::uuid,$18::uuid,$19::jsonb)`,
      [input.chainId,p.tenantKey,input.returnCaseId,input.returnSessionId,
       input.outboundPackageId ?? null,input.shippingCustodyLinkId ?? null,input.arbShipmentId ?? null,
       p.facilityId,p.stationId ?? null,p.deviceId,p.warehouseAuthSessionId,p.warehouseUserId,
       p.warehouseEmployeeId,p.actorType,p.actorId,input.idempotencyKey,correlationId,runId,
       JSON.stringify(input.metadata ?? {})],
    ); return rows[0];
  }

  async linkArtifact(p: ReturnPrincipal,input: {
    linkId:string;artifactId:string;evidenceRole:string;warehouseMediaAssetId?:string;
    sequenceNo:number;idempotencyKey:string;metadata?:Readonly<Record<string,unknown>>;
  },runId:string,correlationId:string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7d1_link_artifact(
       $1::uuid,$2,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::forensic.event_actor_type,$9,$10,$11::uuid,$12::uuid,$13::jsonb)`,
      [input.linkId,p.tenantKey,input.artifactId,input.evidenceRole,input.warehouseMediaAssetId??null,
       input.sequenceNo,p.warehouseUserId,p.actorType,p.actorId,input.idempotencyKey,
       correlationId,runId,JSON.stringify(input.metadata??{})],
    ); return rows[0];
  }

  async recordPackage(p:ReturnPrincipal,input:{
    linkId:string;inspectionId:string;artifactLinkIds:string[];idempotencyKey:string;
  },runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_record_package_attestation(
       $1::uuid,$2,$3::uuid,$4::uuid[],$5::uuid,$6::forensic.event_actor_type,$7,$8,$9::uuid,$10::uuid)`,
      [input.linkId,p.tenantKey,input.inspectionId,input.artifactLinkIds,p.warehouseUserId,
       p.actorType,p.actorId,input.idempotencyKey,correlationId,runId]); return rows[0];
  }

  async recordComponent(p:ReturnPrincipal,input:{
    linkId:string;expectedComponentId?:string;componentName:string;receivedQuantity:number;
    conditionResult?:string;observedIdentityHmac?:string;artifactLinkIds:string[];idempotencyKey:string;
  },runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_record_component_attestation(
       $1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8::uuid[],$9::uuid,
       $10::forensic.event_actor_type,$11,$12,$13::uuid,$14::uuid)`,
      [input.linkId,p.tenantKey,input.expectedComponentId??null,input.componentName,
       input.receivedQuantity,input.conditionResult??null,input.observedIdentityHmac??null,
       input.artifactLinkIds,p.warehouseUserId,p.actorType,p.actorId,input.idempotencyKey,
       correlationId,runId]); return rows[0];
  }

  async recordIdentity(p:ReturnPrincipal,input:{
    linkId:string;returnItemId:string;identifierType:string;observedHmac?:string;
    maskedObservedValue:string;artifactLinkId:string;method:string;secondUserId?:string;
    barcodeScanEventId?:string;observedAt:string;idempotencyKey:string;
  },runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_record_identity_r2(
       $1::uuid,$2,$3::uuid,$4,$5,$6,$7::uuid,$8,$9::uuid,$10::uuid,$11::bigint,$12::timestamptz,
       $13::forensic.event_actor_type,$14,$15,$16::uuid,$17::uuid)`,
      [input.linkId,p.tenantKey,input.returnItemId,input.identifierType,input.observedHmac??null,
       input.maskedObservedValue,input.artifactLinkId,input.method,p.warehouseUserId,
       input.secondUserId??null,input.barcodeScanEventId??null,input.observedAt,p.actorType,
       p.actorId,input.idempotencyKey,correlationId,runId]); return rows[0];
  }

  async recordContinuityException(p:ReturnPrincipal,input:{
    linkId:string;reason:string;details:Readonly<Record<string,unknown>>;idempotencyKey:string;
  },runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_record_continuity_exception(
       $1::uuid,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$7::forensic.event_actor_type,$8,$9,$10::uuid,$11::uuid)`,
      [input.linkId,p.tenantKey,input.reason,JSON.stringify(input.details),p.warehouseUserId,
       p.deviceId,p.actorType,p.actorId,input.idempotencyKey,correlationId,runId]); return rows[0];
  }

  async recordContinuityDecision(p:ReturnPrincipal,input:{
    linkId:string;decision:'APPROVED'|'REJECTED'|'REMEDIATION_REQUIRED';
    warehouseOverrideId?:string;reason:string;supersedesDecisionId?:string;idempotencyKey:string;
  },runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_record_continuity_decision(
       $1::uuid,$2,$3,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,
       $9::forensic.event_actor_type,$10,$11,$12::uuid,$13::uuid)`,
      [input.linkId,p.tenantKey,input.decision,input.warehouseOverrideId??null,input.reason,
       p.warehouseUserId,p.warehouseAuthSessionId,input.supersedesDecisionId??null,p.actorType,
       p.actorId,input.idempotencyKey,correlationId,runId]); return rows[0];
  }

  async evaluate(p:ReturnPrincipal,linkId:string,runId:string,correlationId:string) {
    const {rows}=await this.pool.query(
      `SELECT * FROM forensic.d7d1_evaluate_gate(
       $1::uuid,$2,$3,$4::forensic.event_actor_type,$5::uuid,$6::uuid)`,
      [linkId,p.tenantKey,p.actorId,p.actorType,runId,correlationId]); return rows[0];
  }

  async get(p:ReturnPrincipal,linkId:string) {
    const {rows}=await this.pool.query(
      `SELECT l.*,
       COALESCE((SELECT jsonb_agg(a ORDER BY a.evidence_role,a.sequence_no)
        FROM forensic.return_artifact_links a WHERE a.return_intake_link_id=l.return_intake_link_id),'[]') artifacts,
       COALESCE((SELECT jsonb_agg(e ORDER BY e.occurred_at)
        FROM forensic.return_intake_state_events e WHERE e.return_intake_link_id=l.return_intake_link_id),'[]') state_events
       FROM forensic.return_intake_links l
       WHERE l.return_intake_link_id=$1::uuid AND l.tenant_key=$2`,
      [linkId,p.tenantKey]); return rows[0]??null;
  }
}
