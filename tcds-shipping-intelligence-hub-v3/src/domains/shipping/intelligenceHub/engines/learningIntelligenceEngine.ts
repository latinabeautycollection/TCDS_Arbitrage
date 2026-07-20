export interface ShipmentOutcome {
  shipmentId: number;
  quotedCostUsd: number;
  purchasedLabelCostUsd: number;
  invoicedCostUsd?: number;
  promisedDeliveryEndAt?: Date;
  actualDeliveredAt?: Date;
  claimFiled: boolean;
  claimPaidUsd?: number;
  returned: boolean;
  disputeOpened: boolean;
}

export interface LearningFeature {
  featureGroup: string;
  featureName: string;
  featureValue: unknown;
}

export class LearningIntelligenceEngine {
  extract(outcome: ShipmentOutcome): LearningFeature[] {
    const costVariance =
      (outcome.invoicedCostUsd ?? outcome.purchasedLabelCostUsd) - outcome.quotedCostUsd;
    const late =
      Boolean(outcome.promisedDeliveryEndAt && outcome.actualDeliveredAt) &&
      outcome.actualDeliveredAt!.getTime() > outcome.promisedDeliveryEndAt!.getTime();
    return [
      { featureGroup: "shipping_cost", featureName: "quote_to_actual_variance_usd", featureValue: costVariance },
      { featureGroup: "delivery", featureName: "late_delivery", featureValue: late },
      { featureGroup: "claims", featureName: "claim_filed", featureValue: outcome.claimFiled },
      { featureGroup: "claims", featureName: "claim_paid_usd", featureValue: outcome.claimPaidUsd ?? 0 },
      { featureGroup: "returns", featureName: "returned", featureValue: outcome.returned },
      { featureGroup: "disputes", featureName: "dispute_opened", featureValue: outcome.disputeOpened }
    ];
  }
}
