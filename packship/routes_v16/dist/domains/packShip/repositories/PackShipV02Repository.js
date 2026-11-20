"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackShipV02Repository = void 0;
class PackShipV02Repository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async getTask(authSessionId, taskId) {
        return this.call(`select warehouse.packship_get_task_v2($1::uuid,$2::uuid) result`, [authSessionId, taskId]);
    }
    async listPackagingOptions(authSessionId, taskId) {
        return this.call(`select warehouse.packship_list_packaging_options_v2($1::uuid,$2::uuid) result`, [authSessionId, taskId]);
    }
    async claim(authSessionId, taskId, op) {
        return this.call(`select warehouse.packship_claim_task_v2($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid) result`, [authSessionId, taskId, op.idempotencyKey, op.requestId, op.correlationId]);
    }
    async verifySource(input) {
        return this.call(`select warehouse.packship_verify_source_v2(
         $1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6,$7::uuid,$8::uuid
       ) result`, [input.authSessionId, input.taskId, input.rowVersion, input.barcode,
            JSON.stringify(input.capture), input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async verifyItem(input) {
        return this.call(`select warehouse.packship_verify_item_v2(
         $1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6,$7::uuid,$8::uuid
       ) result`, [input.authSessionId, input.taskId, input.rowVersion, input.barcode,
            JSON.stringify(input.capture), input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async selectPackage(input) {
        return this.call(`select warehouse.packship_select_package_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5,$6,$7::uuid,$8::uuid
      ) result`, [input.authSessionId, input.taskId, input.rowVersion, input.profileId, input.reason ?? null,
            input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async recordMeasurements(input) {
        return this.call(`select warehouse.packship_record_measurements_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::bigint,
        $6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::jsonb,$11,$12::uuid,$13::uuid
      ) result`, [input.authSessionId, input.taskId, input.taskRowVersion, input.packageId, input.packageRowVersion,
            input.weightOz, input.lengthIn, input.widthIn, input.heightIn, JSON.stringify(input.weightSource),
            input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async complete(input) {
        return this.call(`select warehouse.packship_complete_task_v2(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::bigint,$6,$7::uuid,$8::uuid
      ) result`, [input.authSessionId, input.taskId, input.taskRowVersion, input.packageId, input.packageRowVersion,
            input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async verifyLabel(input) {
        return this.call(`select warehouse.packship_verify_label_pair_v2(
        $1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7,$8::uuid,$9::uuid
      ) result`, [input.authSessionId, input.shipmentId, input.trackingBarcode, input.packageBarcode,
            // No physical evidence (typed pair) must be SQL NULL. JSON.stringify(null) is the jsonb value null, which the
            // database sees as present evidence and refuses (PACKSHIP_INPUT_INVALID physicalEvidence) -> 422.
            input.physicalEvidence == null ? null : JSON.stringify(input.physicalEvidence), JSON.stringify(input.capture),
            input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async stageOutbound(input) {
        return this.call(`select warehouse.packship_stage_outbound_v2(
        $1::uuid,$2::uuid,$3,$4::jsonb,$5,$6::uuid,$7::uuid
      ) result`, [input.authSessionId, input.shipmentId, input.locationBarcode, JSON.stringify(input.capture),
            input.op.idempotencyKey, input.op.requestId, input.op.correlationId]);
    }
    async call(sql, values) {
        const result = await this.pool.query(sql, values);
        const value = result.rows[0]?.result;
        if (!value || typeof value !== "object")
            throw new Error("PACKSHIP_V02_RESULT_INVALID");
        return value;
    }
}
exports.PackShipV02Repository = PackShipV02Repository;
