import { Pool } from "pg";
import { FedExApi } from "../providers/fedexApi";
import { FedExRepository } from "../repositories/fedexRepository";

export class FedExTrackingWorker {
  constructor(
    private readonly db: Pool,
    private readonly api = new FedExApi(),
    private readonly repo = new FedExRepository(db)
  ) {}

  async runOnce(limit = 50) {
    const { rows } = await this.db.query(
      `SELECT id, tracking_number
       FROM arb.shipments
       WHERE selected_carrier_code='FEDEX'
         AND tracking_number IS NOT NULL
         AND shipment_status IN ('LABEL_CREATED','ACCEPTED','IN_TRANSIT','EXCEPTION')
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit]
    );

    for (const row of rows) {
      const request = {
        trackingInfo: [{ trackingNumberInfo: { trackingNumber: row.tracking_number } }],
        includeDetailedScans: true,
      };
      const started = Date.now();
      try {
        const response = await this.api.track(request);
        await this.repo.recordApiCall({
          apiArea: "TRACK",
          endpointPath: "/track/v1/trackingnumbers",
          method: "POST",
          request,
          response,
          statusCode: 200,
          success: true,
          durationMs: Date.now() - started,
          shipmentId: Number(row.id),
          trackingNumber: row.tracking_number,
        });
      } catch (error: any) {
        await this.repo.recordApiCall({
          apiArea: "TRACK",
          endpointPath: "/track/v1/trackingnumbers",
          method: "POST",
          request,
          statusCode: error?.statusCode,
          success: false,
          durationMs: Date.now() - started,
          shipmentId: Number(row.id),
          trackingNumber: row.tracking_number,
          errorCode: error?.name,
          errorMessage: error?.message,
        });
      }
    }

    return { processed: rows.length };
  }
}
