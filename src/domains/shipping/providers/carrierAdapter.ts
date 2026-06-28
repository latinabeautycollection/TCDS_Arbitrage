export type CarrierCode = "USPS" | "UPS" | "DHL" | "FEDEX" | "SHIPENGINE";

export interface NormalizedCarrierHealth {
  carrierCode: CarrierCode;
  ok: boolean;
  authOk: boolean;
  environment?: string;
  details?: unknown;
}

export interface NormalizedAddressValidationResult {
  carrierCode: CarrierCode;
  valid: boolean;
  cleanedAddress?: unknown;
  messages?: unknown[];
  raw: unknown;
}

export interface NormalizedRateResult {
  carrierCode: CarrierCode;
  carrierId?: string;
  serviceCode?: string;
  serviceName?: string;
  rateId?: string;
  amount?: number;
  currency?: string;
  deliveryDays?: number;
  trackable?: boolean;
  raw: unknown;
}

export interface NormalizedLabelResult {
  carrierCode: CarrierCode;
  labelId?: string;
  trackingNumber?: string;
  labelUrl?: string;
  costAmount?: number;
  currency?: string;
  raw: unknown;
}

export interface NormalizedTrackingResult {
  carrierCode: CarrierCode;
  trackingNumber: string;
  statusCode?: string;
  statusDescription?: string;
  estimatedDeliveryAt?: string;
  deliveredAt?: string;
  events?: unknown[];
  raw: unknown;
}

export interface CarrierAdapter {
  carrierCode: CarrierCode;
  healthCheck(): Promise<NormalizedCarrierHealth>;
  validateAddress(input: unknown): Promise<NormalizedAddressValidationResult>;
  getRates(input: unknown): Promise<NormalizedRateResult[]>;
  createLabel(input: unknown): Promise<NormalizedLabelResult>;
  track(input: unknown): Promise<NormalizedTrackingResult>;
  createReturnLabel?(input: unknown): Promise<NormalizedLabelResult>;
  voidLabel?(input: unknown): Promise<unknown>;
  schedulePickup?(input: unknown): Promise<unknown>;
  createManifest?(input: unknown): Promise<unknown>;
}
