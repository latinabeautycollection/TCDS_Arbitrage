import type { Pool } from "pg";
import type {
  CaptureEvidence,
  OperationHeaders,
  V02Result,
} from "../contracts/packShipRouteTypes";

export class PackShipV02Repository {
  constructor(private readonly pool: Pool) {}

  async getTask(authSessionId: string, taskId: string): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_get_task_v2($1::uuid,$2::uuid) result`,
      [authSessionId, taskId],
    );
  }

  async claim(authSessionId: string, taskId: string, op: OperationHeaders): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_claim_task_v2($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid) result`,
      [authSessionId, taskId, op.idempotencyKey, op.requestId, op.correlationId],
    );
  }

  async verifySource(input: {
    authSessionId: string;
    taskId: string;
    rowVersion: number;
    barcode: string;
    capture: CaptureEvidence;
    op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_verify_source_v2(
         $1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6,$7::uuid,$8::uuid
       ) result`,
      [input.authSessionId,input.taskId,input.rowVersion,input.barcode,
       JSON.stringify(input.capture),input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async verifyItem(input: {
    authSessionId: string;
    taskId: string;
    rowVersion: number;
    barcode: string;
    capture: CaptureEvidence;
    op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_verify_item_v2(
         $1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6,$7::uuid,$8::uuid
       ) result`,
      [input.authSessionId,input.taskId,input.rowVersion,input.barcode,
       JSON.stringify(input.capture),input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async selectPackage(input: {
    authSessionId: string; taskId: string; rowVersion: number;
    profileId: string; reason?: string; op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_select_package_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5,$6,$7::uuid,$8::uuid
      ) result`,
      [input.authSessionId,input.taskId,input.rowVersion,input.profileId,input.reason ?? null,
       input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async recordMeasurements(input: {
    authSessionId: string; taskId: string; taskRowVersion: number;
    packageId: string; packageRowVersion: number;
    weightOz: number; lengthIn: number; widthIn: number; heightIn: number;
    weightSource: unknown; op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_record_measurements_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::bigint,
        $6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::jsonb,$11,$12::uuid,$13::uuid
      ) result`,
      [input.authSessionId,input.taskId,input.taskRowVersion,input.packageId,input.packageRowVersion,
       input.weightOz,input.lengthIn,input.widthIn,input.heightIn,JSON.stringify(input.weightSource),
       input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async complete(input: {
    authSessionId: string; taskId: string; taskRowVersion: number;
    packageId: string; packageRowVersion: number; op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_complete_task_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::bigint,$6,$7::uuid,$8::uuid
      ) result`,
      [input.authSessionId,input.taskId,input.taskRowVersion,input.packageId,input.packageRowVersion,
       input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async verifyLabel(input: {
    authSessionId: string; shipmentId: string; trackingBarcode: string; packageBarcode: string;
    physicalEvidence?: unknown; capture: CaptureEvidence; op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_verify_label_pair_v2(
        $1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7,$8::uuid,$9::uuid
      ) result`,
      [input.authSessionId,input.shipmentId,input.trackingBarcode,input.packageBarcode,
       JSON.stringify(input.physicalEvidence ?? null),JSON.stringify(input.capture),
       input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  async stageOutbound(input: {
    authSessionId: string; shipmentId: string; locationBarcode: string;
    capture: CaptureEvidence; op: OperationHeaders;
  }): Promise<V02Result> {
    return this.call(
      `select warehouse.packship_stage_outbound_v2(
        $1::uuid,$2::uuid,$3,$4::jsonb,$5,$6::uuid,$7::uuid
      ) result`,
      [input.authSessionId,input.shipmentId,input.locationBarcode,JSON.stringify(input.capture),
       input.op.idempotencyKey,input.op.requestId,input.op.correlationId],
    );
  }

  private async call(sql: string, values: unknown[]): Promise<V02Result> {
    const result = await this.pool.query<{ result: V02Result }>(sql, values);
    const value = result.rows[0]?.result;
    if (!value || typeof value !== "object") throw new Error("PACKSHIP_V02_RESULT_INVALID");
    return value;
  }
}
