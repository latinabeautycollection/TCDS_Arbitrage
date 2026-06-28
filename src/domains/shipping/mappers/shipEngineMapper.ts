import { normalizeMoney } from "../utils/shipEngineUtils";

export function mapShipEngineRate(rate: any) {
  const shipping = normalizeMoney(rate.shipping_amount);
  const insurance = normalizeMoney(rate.insurance_amount);
  return {
    rateId: rate.rate_id,
    carrierId: rate.carrier_id,
    carrierCode: rate.carrier_code,
    carrierFriendlyName: rate.carrier_friendly_name,
    serviceCode: rate.service_code,
    serviceType: rate.service_type,
    rateType: rate.rate_type,
    packageType: rate.package_type,
    deliveryDays: rate.delivery_days,
    estimatedDeliveryDate: rate.estimated_delivery_date,
    guaranteedService: rate.guaranteed_service,
    trackable: rate.trackable,
    validationStatus: rate.validation_status,
    shippingAmount: shipping.amount,
    shippingCurrency: shipping.currency,
    insuranceAmount: insurance.amount,
    warningMessages: rate.warning_messages ?? [],
    errorMessages: rate.error_messages ?? [],
    raw: rate,
  };
}

export function mapShipEngineLabel(label: any) {
  return {
    labelId: label.label_id,
    shipmentId: label.shipment_id,
    externalShipmentId: label.external_shipment_id,
    externalOrderId: label.external_order_id,
    status: label.status,
    carrierId: label.carrier_id,
    carrierCode: label.carrier_code,
    serviceCode: label.service_code,
    packageCode: label.package_code,
    trackingNumber: label.tracking_number,
    trackingStatus: label.tracking_status,
    trackingUrl: label.tracking_url,
    labelFormat: label.label_format,
    labelLayout: label.label_layout,
    labelDownloadUrl: label.label_download?.href ?? label.label_download?.pdf,
    formDownloadUrl: label.form_download?.href,
    qrCodeDownloadUrl: label.qr_code_download?.href,
    insuranceClaimUrl: label.insurance_claim?.href,
    isReturnLabel: Boolean(label.is_return_label),
    rmaNumber: label.rma_number,
    voided: label.voided,
    voidedAt: label.voided_at,
    refundStatus: label.refund_details?.refund_status,
    shipmentCost: normalizeMoney(label.shipment_cost),
    insuranceCost: normalizeMoney(label.insurance_cost),
    raw: label,
  };
}

export function mapShipEngineTracking(raw: any) {
  return {
    trackingNumber: raw.tracking_number,
    trackingUrl: raw.tracking_url,
    statusCode: raw.status_code,
    statusDetailCode: raw.status_detail_code,
    statusDescription: raw.status_description,
    statusDetailDescription: raw.status_detail_description,
    carrierCode: raw.carrier_code,
    carrierId: raw.carrier_id,
    carrierStatusCode: raw.carrier_status_code,
    carrierDetailCode: raw.carrier_detail_code,
    carrierStatusDescription: raw.carrier_status_description,
    shipDate: raw.ship_date,
    estimatedDeliveryDate: raw.estimated_delivery_date,
    actualDeliveryDate: raw.actual_delivery_date,
    exceptionDescription: raw.exception_description,
    events: raw.events ?? [],
    raw,
  };
}
