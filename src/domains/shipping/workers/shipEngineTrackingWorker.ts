import { Pool } from "pg";
import { ShipEngineApi } from "../providers/shipEngineApi";
import { ShipEngineRepository } from "../repositories/shipEngineRepository";

export class ShipEngineTrackingWorker {
  constructor(
    private readonly db: Pool,
    private readonly api = new ShipEngineApi(),
    private readonly repository = new ShipEngineRepository(db)
  ) {}

  async pollTracking(inputs: Array<{ carrier_code?: string; carrier_id?: string; tracking_number: string }>) {
    const results = [];
    for (const input of inputs) {
      const response = await this.api.track(input);
      const id = await this.repository.recordTracking({ response });
      results.push({ tracking_number: input.tracking_number, id });
    }
    return results;
  }
}
