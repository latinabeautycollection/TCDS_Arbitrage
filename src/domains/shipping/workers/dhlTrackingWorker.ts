import { Pool } from "pg";
import { DhlApi } from "../providers/dhlApi";
import { DhlRepository } from "../repositories/dhlRepository";

export class DhlTrackingWorker {
  constructor(
    private readonly db: Pool,
    private readonly api = new DhlApi(),
    private readonly repository = new DhlRepository(db)
  ) {}

  async pollTrackingNumbers(trackingNumbers: string[]) {
    const results = [];
    for (const trackingNumber of trackingNumbers) {
      const response = await this.api.track({ trackingNumber });
      const snapshotId = await this.repository.recordTracking({ trackingNumber, response });
      results.push({ trackingNumber, snapshotId });
    }
    return results;
  }
}
