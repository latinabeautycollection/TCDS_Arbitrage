import type { Pool } from "pg";
import type { NormalizedTrackingEvent, TrackingEventGateway } from "../contracts/trackingEventGateway";

export class ExistingTrackingAdapter implements TrackingEventGateway {
  constructor(private readonly pool: Pool) {}

  async getEvents(shipmentId: number): Promise<NormalizedTrackingEvent[]> {
    const result = await this.pool.query<{
      shipment_id: number;
      carrier_code: string;
      tracking_number: string | null;
      event_code: string | null;
      event_description: string | null;
      event_location: string | null;
      event_time: Date;
    }>(
      `select shipment_id, carrier_code, tracking_number, event_code,
              event_description, event_location, event_time
         from arb.shipment_tracking_events
        where shipment_id = $1
        order by event_time asc`,
      [shipmentId]
    );
    return result.rows.map((row) => ({
      shipmentId: row.shipment_id,
      carrierCode: row.carrier_code,
      trackingNumber: row.tracking_number ?? undefined,
      eventCode: row.event_code ?? undefined,
      eventDescription: row.event_description ?? undefined,
      eventLocation: row.event_location ?? undefined,
      eventTime: row.event_time,
      delivered: /DELIVER/i.test(row.event_code ?? row.event_description ?? ""),
      exception: /EXCEPTION|DELAY|FAIL|RETURN/i.test(row.event_code ?? row.event_description ?? "")
    }));
  }
}
