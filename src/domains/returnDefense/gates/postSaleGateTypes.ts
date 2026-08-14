
export type PostSaleGateStage =
  | "LISTING_DEFENSIBILITY"
  | "ORDER_FULFILLMENT"
  | "PACKING_SHIPMENT_RELEASE"
  | "DELIVERY_INTERVENTION"
  | "RETURN_DISPUTE_RECOVERY";

export interface PostSaleGateEvaluation {
  riskScore: number;
  hardBlock: boolean;
  reasonCodes: string[];
  controls: Array<Record<string, unknown>>;
  interventions?: Array<Record<string, unknown>>;
  recommendedGateStatus:
    | "ALLOW"
    | "ALLOW_WITH_CONTROLS"
    | "REVIEW"
    | "HOLD"
    | "BLOCK";
  recommendedOutcome?: string;
}
