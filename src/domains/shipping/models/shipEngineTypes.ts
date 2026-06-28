export interface ShipEngineTrackInput {
  carrier_code?: string;
  carrier_id?: string;
  tracking_number: string;
}

export interface ShipEngineLabelOptions {
  validate_address?: "no_validation" | "validate_only" | "validate_and_clean";
  label_layout?: "4x6" | "letter" | "A4" | "A6";
  label_format?: "pdf" | "png" | "zpl";
  label_download_type?: "url" | "inline";
  display_scheme?: "label" | "paperless" | "label_and_paperless";
}

export interface ShipEngineDecisionResult {
  carrier: "SHIPENGINE";
  selectedCarrierCode?: string;
  selectedCarrierId?: string;
  selectedServiceCode?: string;
  selectedRateId?: string;
  selectedLabelId?: string;
  selectedPriceUsd?: number;
  riskScore: number;
  profitScore: number;
  confidenceScore: number;
  humanReviewRequired: boolean;
  executiveHoldRequired: boolean;
  reason: string;
  raw: unknown;
}
