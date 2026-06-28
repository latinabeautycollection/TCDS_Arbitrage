import { Pool } from "pg";
import { hashJson, hashSecret, dimWeightLb } from "../utils/fedexUtils";
import { mapFedExRateOptions } from "../mappers/fedexMapper";

export class FedExRepository {
  constructor(private readonly db: Pool) {}

  async recordApiCall(args: {
    apiArea: string;
    endpointPath: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    request: unknown;
    response?: unknown;
    statusCode?: number;
    success: boolean;
    durationMs?: number;
    shipmentId?: number;
    shipmentQuoteId?: number;
    ebayOrderFk?: number;
    trackingNumber?: string;
    errorCode?: string;
    errorMessage?: string;
    processRunId?: string;
  }) {
    const { rows } = await this.db.query(
      `INSERT INTO arb.fedex_api_ledger (
        api_area, endpoint_path, http_method, shipment_id, shipment_quote_id, ebay_order_fk, tracking_number,
        request_hash, response_hash, request_json, response_json, status_code, success, duration_ms,
        error_code, error_message, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17)
      RETURNING id`,
      [
        args.apiArea,
        args.endpointPath,
        args.method,
        args.shipmentId ?? null,
        args.shipmentQuoteId ?? null,
        args.ebayOrderFk ?? null,
        args.trackingNumber ?? null,
        hashJson(args.request),
        args.response ? hashJson(args.response) : null,
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        args.statusCode ?? null,
        args.success,
        args.durationMs ?? null,
        args.errorCode ?? null,
        args.errorMessage ?? null,
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async saveRateQuotes(args: {
    request: any;
    response: any;
    shipmentId?: number;
    ebayOrderFk?: number;
    processRunId?: string;
  }) {
    const options = mapFedExRateOptions(args.response);
    const ids: number[] = [];

    for (const option of options) {
      const { rows } = await this.db.query(
        `INSERT INTO arb.fedex_rate_quote_events (
          shipment_id, ebay_order_fk, origin_postal_code, destination_postal_code, service_type,
          service_name, packaging_type, pickup_type, rate_request_type, currency, total_net_charge_usd,
          weight_lb, length_in, width_in, height_in, dim_weight_lb, request_hash, response_hash,
          request_json, response_json, normalized_json, process_run_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21)
        RETURNING id`,
        [
          args.shipmentId ?? null,
          args.ebayOrderFk ?? null,
          args.request?.requestedShipment?.shipper?.address?.postalCode ?? args.request?.originPostalCode ?? null,
          args.request?.requestedShipment?.recipient?.address?.postalCode ?? args.request?.destinationPostalCode ?? null,
          option.serviceType,
          option.serviceName,
          args.request?.requestedShipment?.packagingType ?? null,
          args.request?.requestedShipment?.pickupType ?? null,
          args.request?.rateRequestControlParameters?.rateSortOrder ?? null,
          option.priceUsd,
          args.request?.weightLb ?? null,
          args.request?.lengthIn ?? null,
          args.request?.widthIn ?? null,
          args.request?.heightIn ?? null,
          args.request?.lengthIn ? dimWeightLb(args.request.lengthIn, args.request.widthIn, args.request.heightIn) : null,
          hashJson(args.request),
          hashJson(option.raw),
          JSON.stringify(args.request ?? {}),
          JSON.stringify(args.response ?? {}),
          JSON.stringify(option),
          args.processRunId ?? null,
        ]
      );
      ids.push(Number(rows[0].id));
    }

    return ids;
  }

  async saveWebhook(args: { headers: unknown; payload: any; signatureValid?: boolean }) {
    const payloadHash = hashJson(args.payload);
    const trackingNumber = args.payload?.trackingNumber || args.payload?.tracking_number || args.payload?.trackNumber || null;

    const { rows } = await this.db.query(
      `INSERT INTO arb.fedex_webhook_events (
        event_type, fedex_event_id, tracking_number, headers_json, raw_payload, payload_hash,
        signature_present, signature_valid, processing_status
      )
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'RECEIVED')
      ON CONFLICT (event_source, payload_hash)
      DO UPDATE SET processing_status='DUPLICATE', retry_count=arb.fedex_webhook_events.retry_count + 1
      RETURNING id`,
      [
        args.payload?.eventType || args.payload?.type || null,
        args.payload?.eventId || args.payload?.id || null,
        trackingNumber,
        JSON.stringify(args.headers ?? {}),
        JSON.stringify(args.payload ?? {}),
        payloadHash,
        Boolean((args.headers as any)?.["x-fedex-signature"]),
        args.signatureValid ?? null,
      ]
    );

    return Number(rows[0].id);
  }

  accountHash(account?: string) {
    return hashSecret(account);
  }
}
