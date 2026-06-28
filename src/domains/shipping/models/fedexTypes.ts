export interface FedExOAuthToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

export interface FedExApiResult<T = unknown> {
  ok: boolean;
  statusCode: number;
  transactionId?: string;
  data: T;
}

export interface FedExRateShopInput {
  originPostalCode: string;
  originCountryCode?: string;
  destinationPostalCode: string;
  destinationCountryCode?: string;
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  itemValueUsd?: number;
  serviceTypes?: string[];
  residential?: boolean;
  fragile?: boolean;
}

export interface FedExDecisionResult {
  carrier: "FEDEX";
  selectedServiceType?: string;
  selectedPriceUsd?: number;
  cheapestPriceUsd?: number;
  riskScore: number;
  profitScore: number;
  confidenceScore: number;
  humanReviewRequired: boolean;
  executiveHoldRequired: boolean;
  reason: string;
  raw: unknown;
}
