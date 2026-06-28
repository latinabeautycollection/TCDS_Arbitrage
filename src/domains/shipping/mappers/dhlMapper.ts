export function mapDhlTrackingResponse(raw: any, trackingNumber: string) {
  const shipments = Array.isArray(raw?.shipments) ? raw.shipments : [];
  const shipment = shipments[0] ?? {};
  const status = shipment.status ?? {};
  const details = shipment.details ?? {};
  return {
    trackingNumber,
    shipmentId: shipment.id,
    service: shipment.service,
    provider: shipment.provider?.providerCode ?? shipment.provider,
    productName: details.product?.productName,
    statusCode: status.statusCode,
    statusText: status.status,
    statusDescription: status.description ?? status.remark,
    statusTimestamp: status.timestamp,
    origin: shipment.origin?.address ?? {},
    destination: shipment.destination?.address ?? {},
    estimatedDelivery: shipment.estimatedTimeOfDelivery,
    proofOfDeliveryUrl: shipment.proofOfDelivery?.documentURL,
    signatureUrl: shipment.proofOfDelivery?.signatureURL,
    weight: details.weight ?? {},
    events: Array.isArray(shipment.events) ? shipment.events : [],
    shipment,
    raw,
  };
}

export function mapDhlReturnLabelResponse(raw: any) {
  return {
    authorizationNumber: raw?.authorizationNumber,
    dhlPackageId: raw?.dhlPackageId,
    trackingId: raw?.trackingId,
    labelFormat: raw?.labelFormat ?? raw?.format,
    encodeType: raw?.encodeType,
    labelData: raw?.labelData,
    raw,
  };
}

export function mapDhlLocations(raw: any) {
  const locations = raw?.locations ?? raw?.items ?? [];
  return Array.isArray(locations) ? locations : locations ? [locations] : [];
}

export function mapDhlFreightPriceQuote(raw: any) {
  const rows = Array.isArray(raw) ? raw : raw?.items ?? raw?.priceQuote ?? [];
  const list = Array.isArray(rows) ? rows : [];
  const byId = Object.fromEntries(list.map((x: any) => [x.id, x]));
  return {
    rows: list,
    freightCost: Number(byId.FreightCost?.value ?? 0) || undefined,
    fuelSurcharge: Number(byId.FuelSurcharge?.value ?? 0) || undefined,
    insurance: Number(byId.insurance?.value ?? 0) || undefined,
    totalPrice: Number(byId.TotalPrice?.value ?? 0) || undefined,
    currency: byId.TotalPrice?.unit,
    raw,
  };
}
