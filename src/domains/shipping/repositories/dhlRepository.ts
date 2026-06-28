import { Pool } from "pg";
import { hashJson, hashText } from "../utils/dhlUtils";
import { mapDhlLocations, mapDhlReturnLabelResponse, mapDhlTrackingResponse, mapDhlFreightPriceQuote } from "../mappers/dhlMapper";

export class DhlRepository {
  constructor(private readonly db: Pool) {}

  async recordTracking(args: { trackingNumber: string; response: any; shipmentId?: number; ebayOrderFk?: number; processRunId?: string }) {
    const mapped = mapDhlTrackingResponse(args.response, args.trackingNumber);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.dhl_tracking_snapshots (
        shipment_id, ebay_order_fk, tracking_number, dhl_shipment_id, service, provider,
        product_name, status_code, status_text, status_description, status_timestamp,
        origin_country_code, origin_postal_code, origin_locality,
        destination_country_code, destination_postal_code, destination_locality,
        estimated_delivery_at, proof_of_delivery_url, signature_url, weight_value, weight_unit,
        raw_response_json, shipment_json, snapshot_hash, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13,$14,$15,$16,$17,$18::timestamptz,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25,$26)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.ebayOrderFk ?? null,
        args.trackingNumber,
        mapped.shipmentId ?? null,
        mapped.service ?? null,
        mapped.provider ?? null,
        mapped.productName ?? null,
        mapped.statusCode ?? null,
        mapped.statusText ?? null,
        mapped.statusDescription ?? null,
        mapped.statusTimestamp ?? null,
        mapped.origin?.countryCode ?? null,
        mapped.origin?.postalCode ?? null,
        mapped.origin?.addressLocality ?? null,
        mapped.destination?.countryCode ?? null,
        mapped.destination?.postalCode ?? null,
        mapped.destination?.addressLocality ?? null,
        mapped.estimatedDelivery ?? null,
        mapped.proofOfDeliveryUrl ?? null,
        mapped.signatureUrl ?? null,
        mapped.weight?.value ?? null,
        mapped.weight?.unitText ?? null,
        JSON.stringify(args.response ?? {}),
        JSON.stringify(mapped.shipment ?? {}),
        hashJson(args.response),
        args.processRunId ?? null,
      ]
    );
    const snapshotId = Number(rows[0].id);
    for (const event of mapped.events) {
      await this.db.query(
        `
        INSERT INTO arb.dhl_tracking_event_details (
          dhl_tracking_snapshot_id, shipment_id, tracking_number, event_timestamp,
          event_status_code, event_status, event_description, event_country_code,
          event_postal_code, event_locality, raw_event_json, event_hash
        )
        VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
        `,
        [
          snapshotId,
          args.shipmentId ?? null,
          args.trackingNumber,
          event.timestamp ?? null,
          event.statusCode ?? null,
          event.status ?? null,
          event.description ?? event.remark ?? null,
          event.location?.address?.countryCode ?? null,
          event.location?.address?.postalCode ?? null,
          event.location?.address?.addressLocality ?? null,
          JSON.stringify(event ?? {}),
          hashJson(event),
        ]
      );
    }
    return snapshotId;
  }

  async recordWebhook(args: { headers: any; payload: any; basicAuthValid?: boolean }) {
    const payload = args.payload ?? {};
    const trackingNumber = payload.trackingNumber ?? payload.id ?? payload.shipments?.[0]?.id ?? null;
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.dhl_tracking_webhook_events (
        hook_id, tracking_number, basic_auth_valid, headers_json, raw_payload, payload_hash, event_count
      )
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
      ON CONFLICT (tracking_number, payload_hash)
      DO UPDATE SET processing_status='DUPLICATE'
      RETURNING id
      `,
      [
        payload.hookId ?? null,
        trackingNumber,
        args.basicAuthValid ?? null,
        JSON.stringify(args.headers ?? {}),
        JSON.stringify(payload),
        hashJson(payload),
        Array.isArray(payload.events) ? payload.events.length : Array.isArray(payload.shipments?.[0]?.events) ? payload.shipments[0].events.length : 0,
      ]
    );
    return Number(rows[0].id);
  }

  async recordReturnLabel(args: { request: any; response: any; shipmentId?: number; returnCaseId?: number; processRunId?: string }) {
    const mapped = mapDhlReturnLabelResponse(args.response);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.dhl_return_label_events (
        shipment_id, return_case_id, pickup_account, ordered_product_id, merchant_id, order_number,
        authorization_number, dhl_package_id, tracking_id, label_format, label_encode_type,
        label_hash, shipper_address_json, return_address_json, package_detail_json,
        request_hash, response_hash, request_json, response_json, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19::jsonb,$20)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.returnCaseId ?? null,
        args.request?.pickup,
        args.request?.orderedProductId,
        args.request?.merchantId ?? null,
        args.request?.packageDetail?.orderNumber ?? null,
        mapped.authorizationNumber ?? args.request?.packageDetail?.authorizationNumber ?? null,
        mapped.dhlPackageId ?? null,
        mapped.trackingId ?? null,
        mapped.labelFormat ?? args.request?.labelFormat ?? null,
        mapped.encodeType ?? null,
        mapped.labelData ? hashText(String(mapped.labelData)) : null,
        JSON.stringify(args.request?.shipperAddress ?? {}),
        JSON.stringify(args.request?.returnAddress ?? {}),
        JSON.stringify(args.request?.packageDetail ?? {}),
        hashJson(args.request),
        hashJson(args.response),
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordLocationSearch(args: { searchType: "ADDRESS" | "GEO" | "KEYWORD_ID" | "LOCATION_ID"; request: any; response: any; processRunId?: string }) {
    const locations = mapDhlLocations(args.response);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.dhl_location_search_events (
        search_type, country_code, postal_code, address_locality, latitude, longitude,
        provider_type, service_type, location_type, result_count, request_hash,
        response_hash, request_json, response_json, normalized_locations_json, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16)
      RETURNING id
      `,
      [
        args.searchType,
        args.request?.countryCode ?? null,
        args.request?.postalCode ?? null,
        args.request?.addressLocality ?? null,
        args.request?.latitude ?? null,
        args.request?.longitude ?? null,
        args.request?.providerType ?? null,
        args.request?.serviceType ?? null,
        args.request?.locationType ?? null,
        locations.length,
        hashJson(args.request),
        hashJson(args.response),
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        JSON.stringify(locations),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }

  async recordFreightQuote(args: { request: any; response: any; shipmentId?: number; processRunId?: string }) {
    const mapped = mapDhlFreightPriceQuote(args.response);
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.dhl_freight_price_quote_events (
        shipment_id, product_code, payer_code, currency_code, freight_cost,
        fuel_surcharge, insurance_cost, total_price, calculation_basis_json,
        request_hash, response_hash, request_json, response_json, process_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14)
      RETURNING id
      `,
      [
        args.shipmentId ?? null,
        args.request?.productCode ?? null,
        args.request?.payerCode ?? null,
        mapped.currency ?? null,
        mapped.freightCost ?? null,
        mapped.fuelSurcharge ?? null,
        mapped.insurance ?? null,
        mapped.totalPrice ?? null,
        JSON.stringify(mapped.rows),
        hashJson(args.request),
        hashJson(args.response),
        JSON.stringify(args.request ?? {}),
        JSON.stringify(args.response ?? {}),
        args.processRunId ?? null,
      ]
    );
    return Number(rows[0].id);
  }
}
