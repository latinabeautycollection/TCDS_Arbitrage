import { extractFedExRateAmount, fedexTrackingRisk } from "../utils/fedexUtils";

export function mapFedExRateOptions(raw: any) {
  const details = raw?.output?.rateReplyDetails ?? raw?.rateReplyDetails ?? [];
  return details
    .map((detail: any) => ({
      carrier: "FEDEX",
      serviceType: detail.serviceType,
      serviceName: detail.serviceName ?? detail.serviceType,
      priceUsd: extractFedExRateAmount(detail),
      raw: detail,
    }))
    .filter((option: any) => option.priceUsd !== undefined)
    .sort((a: any, b: any) => Number(a.priceUsd) - Number(b.priceUsd));
}

export function mapFedExTracking(raw: any) {
  const completeResults = raw?.output?.completeTrackResults ?? raw?.completeTrackResults ?? [];
  return completeResults.flatMap((r: any) =>
    (r.trackResults ?? []).map((item: any) => ({
      trackingNumber: item.trackingNumberInfo?.trackingNumber,
      statusCode: item.latestStatusDetail?.code,
      statusDescription: item.latestStatusDetail?.description,
      riskCode: fedexTrackingRisk(item),
      raw: item,
    }))
  );
}
