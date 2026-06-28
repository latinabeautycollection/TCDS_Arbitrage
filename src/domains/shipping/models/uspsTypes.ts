export interface UspsOAuthTokenResponse {
  access_token: string; token_type?: string; issued_at?: number; expires_in?: number;
  status?: string; scope?: string; issuer?: string; client_id?: string; application_name?: string;
  api_products?: string; public_key?: string; refresh_token?: string;
}
export interface UspsRateShopInput {
  originZIPCode: string; destinationZIPCode: string; weight: number; length: number; width: number; height: number;
  itemValue?: number; categoryKey?: string; fragile?: boolean; priceType?: "RETAIL" | "COMMERCIAL" | "CONTRACT" | "NSA";
  requireInsurance?: boolean; requireSignature?: boolean; requireRestrictedDelivery?: boolean;
}
export interface UspsDecisionResult {
  carrier: "USPS"; selectedMailClass?: string; selectedPriceUsd?: number; cheapestPriceUsd?: number;
  riskScore: number; profitScore: number; confidenceScore: number; humanReviewRequired: boolean;
  executiveHoldRequired: boolean; reason: string; raw: unknown;
}
