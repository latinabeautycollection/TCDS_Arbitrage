import { Pool } from "pg";
import { hashJson, hashText } from "../utils/shipEngineUtils";
import { mapShipEngineLabel, mapShipEngineRate, mapShipEngineTracking } from "../mappers/shipEngineMapper";

export class ShipEngineRepository {
  constructor(private readonly db: Pool) {}

  async recordAddressValidation(args: { request: any; response: any; shipmentId?: number; ebayOrderFk?: number; processRunId?: string }) {
    const result = Array.isArray(args.response) ? args.response[0] ?? {} : args.response ?? {};
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipengine_address_validation_events (
        shipment_id, ebay_order_fk, validation_status, address_residential_indicator,
        original_address_json, matched_address_json, messages_json, request_hash, response_hash,
        request_json, response_json, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.ebayOrderFk ?? null,
        result.status ?? null,
        result.matched_address?.address_residential_indicator ?? result.original_address?.address_residential_indicator ?? null,
        JSON.stringify(result.original_address ?? {}),
        JSON.stringify(result.matched_address ?? {}),
        JSON.stringify(result.messages ?? []),
        hashJson(args.request),
        hashJson(args.response),
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordRecognition(args: { type: "ADDRESS" | "SHIPMENT"; request: any; response: any; processRunId?: string }) {
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipengine_recognition_events (
        recognition_type, score, parsed_address_json, parsed_shipment_json, entities_json,
        source_text_hash, request_hash, response_hash, request_json, response_json, process_run_id
      )
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
      RETURNING id
      `,
      [
        args.type,
        args.response?.score ?? null,
        JSON.stringify(args.response?.address ?? {}),
        JSON.stringify(args.response?.shipment ?? {}),
        JSON.stringify(args.response?.entities ?? []),
        hashText(String(args.request?.text ?? "")),
        hashJson(args.request),
        hashJson(args.response),
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordRates(args: { request: any; response: any; shipmentId?: number; ebayOrderFk?: number; processRunId?: string }) {
    const rateList = Array.isArray(args.response) ? args.response : args.response?.rate_response?.rates ?? args.response?.rates ?? [];
    const ids: number[] = [];
    for (const rate of rateList) {
      const mapped = mapShipEngineRate(rate);
      const { rows } = await this.db.query(
        `
        INSERT INTO arb.shipengine_rate_events (
          shipment_id, ebay_order_fk, shipengine_shipment_id, rate_request_id, rate_id,
          carrier_id, carrier_code, carrier_friendly_name, service_code, service_type, rate_type,
          package_type, delivery_days, estimated_delivery_date, guaranteed_service, trackable,
          validation_status, shipping_amount, shipping_currency, insurance_amount,
          warning_messages_json, error_messages_json, raw_rate_json, request_hash, response_hash,
          request_json, response_json, process_run_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,$26::jsonb,$27::jsonb,$28)
        RETURNING id
        `,
        [
          args.shipmentId ?? null,
          args.ebayOrderFk ?? null,
          args.response?.shipment_id ?? null,
          args.response?.rate_response?.rate_request_id ?? args.response?.rate_request_id ?? null,
          mapped.rateId ?? null,
          mapped.carrierId ?? null,
          mapped.carrierCode ?? null,
          mapped.carrierFriendlyName ?? null,
          mapped.serviceCode ?? null,
          mapped.serviceType ?? null,
          mapped.rateType ?? null,
          mapped.packageType ?? null,
          mapped.deliveryDays ?? null,
          mapped.estimatedDeliveryDate ?? null,
          mapped.guaranteedService ?? null,
          mapped.trackable ?? null,
          mapped.validationStatus ?? null,
          mapped.shippingAmount ?? null,
          mapped.shippingCurrency ?? null,
          mapped.insuranceAmount ?? null,
          JSON.stringify(mapped.warningMessages ?? []),
          JSON.stringify(mapped.errorMessages ?? []),
          JSON.stringify(mapped.raw ?? {}),
          hashJson(args.request),
          hashJson(args.response),
          JSON.stringify(args.request ?? {}),
          JSON.stringify(args.response ?? {}),
          args.processRunId ?? null,
        ]
      );
      ids.push(Number(rows[0].id));
    }
    return ids;
  }

  async recordLabel(args: { response: any; shipmentId?: number; ebayOrderFk?: number; processRunId?: string }) {
    const mapped = mapShipEngineLabel(args.response);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipengine_label_events (
        shipment_id, ebay_order_fk, label_id, shipengine_shipment_id, external_shipment_id,
        external_order_id, status, carrier_id, carrier_code, service_code, package_code,
        tracking_number, tracking_status, tracking_url, label_format, label_layout,
        label_download_url, form_download_url, qr_code_download_url, insurance_claim_url,
        is_return_label, rma_number, voided, voided_at, refund_status,
        shipment_cost_amount, shipment_cost_currency, insurance_cost_amount, insurance_cost_currency,
        raw_response_json, label_hash, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::timestamptz,$25,$26,$27,$28,$29,$30::jsonb,$31,$32)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.ebayOrderFk ?? null,
        mapped.labelId,
        mapped.shipmentId ?? null,
        mapped.externalShipmentId ?? null,
        mapped.externalOrderId ?? null,
        mapped.status ?? null,
        mapped.carrierId ?? null,
        mapped.carrierCode ?? null,
        mapped.serviceCode ?? null,
        mapped.packageCode ?? null,
        mapped.trackingNumber ?? null,
        mapped.trackingStatus ?? null,
        mapped.trackingUrl ?? null,
        mapped.labelFormat ?? null,
        mapped.labelLayout ?? null,
        mapped.labelDownloadUrl ?? null,
        mapped.formDownloadUrl ?? null,
        mapped.qrCodeDownloadUrl ?? null,
        mapped.insuranceClaimUrl ?? null,
        mapped.isReturnLabel,
        mapped.rmaNumber ?? null,
        mapped.voided ?? null,
        mapped.voidedAt ?? null,
        mapped.refundStatus ?? null,
        mapped.shipmentCost.amount ?? null,
        mapped.shipmentCost.currency ?? null,
        mapped.insuranceCost.amount ?? null,
        mapped.insuranceCost.currency ?? null,
        JSON.stringify(mapped.raw ?? {}),
        hashJson(args.response),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordTracking(args: { response: any; shipmentId?: number; labelId?: string; processRunId?: string }) {
    const mapped = mapShipEngineTracking(args.response);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipengine_tracking_events (
        shipment_id, label_id, carrier_code, carrier_id, tracking_number, tracking_url,
        status_code, status_detail_code, status_description, status_detail_description,
        carrier_status_code, carrier_detail_code, carrier_status_description,
        ship_date, estimated_delivery_date, actual_delivery_date, exception_description,
        events_json, raw_response_json, tracking_hash, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz,$16::timestamptz,$17,$18::jsonb,$19::jsonb,$20,$21)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.labelId ?? null,
        mapped.carrierCode ?? null,
        mapped.carrierId ? String(mapped.carrierId) : null,
        mapped.trackingNumber,
        mapped.trackingUrl ?? null,
        mapped.statusCode ?? null,
        mapped.statusDetailCode ?? null,
        mapped.statusDescription ?? null,
        mapped.statusDetailDescription ?? null,
        mapped.carrierStatusCode ? String(mapped.carrierStatusCode) : null,
        mapped.carrierDetailCode ?? null,
        mapped.carrierStatusDescription ?? null,
        mapped.shipDate ?? null,
        mapped.estimatedDeliveryDate ?? null,
        mapped.actualDeliveryDate ?? null,
        mapped.exceptionDescription ?? null,
        JSON.stringify(mapped.events ?? []),
        JSON.stringify(mapped.raw ?? {}),
        hashJson(args.response),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordWebhook(args: { headers: any; payload: any; secretValid: boolean }) {
    const payload = args.payload ?? {};
    const event = payload.event ?? payload.resource_type ?? payload.type ?? "unknown";
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipengine_webhook_events (
        webhook_id, event, resource_url, label_id, tracking_number, secret_valid, headers_json, raw_payload, payload_hash
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
      ON CONFLICT (event, payload_hash)
      DO UPDATE SET processing_status='DUPLICATE'
      RETURNING id
      `,
      [
        payload.webhook_id ?? null,
        event,
        payload.resource_url ?? payload.url ?? null,
        payload.label_id ?? payload.data?.label_id ?? null,
        payload.tracking_number ?? payload.data?.tracking_number ?? null,
        args.secretValid,
        JSON.stringify(args.headers ?? {}),
        JSON.stringify(payload),
        hashJson(payload),
      ]
    );
    return Number(rows[0].id);
  }
}
