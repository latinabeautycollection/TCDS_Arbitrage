export interface DhlTrackInput {
  trackingNumber: string;
  service?: string;
  requesterCountryCode?: string;
  originCountryCode?: string;
  recipientPostalCode?: string;
  language?: string;
  offset?: number;
  limit?: number;
}

export interface DhlReturnLabelInput {
  pickup: string;
  orderedProductId: string;
  merchantId?: string;
  labelFormat?: "PNG" | "ZPL" | "PDF" | "QR";
  shipperAddress: Record<string, unknown>;
  returnAddress: Record<string, unknown>;
  packageDetail: Record<string, unknown>;
}

export interface DhlWebhookSubscriptionInput {
  pickup?: string;
  trackingId?: string;
  hookType: "TRACK_EVENTS";
  url: string;
  username?: string;
  password?: string;
  active: boolean;
}

export interface DhlDecisionResult {
  carrier: "DHL";
  selectedService?: string;
  selectedPriceUsd?: number;
  riskScore: number;
  profitScore: number;
  confidenceScore: number;
  humanReviewRequired: boolean;
  executiveHoldRequired: boolean;
  reason: string;
  raw: unknown;
}
