export type CarrierCode = 'USPS' | 'UPS' | 'FEDEX' | 'DHL';

export interface PackageDimensions {
  length: number;
  width: number;
  height: number;
  unit: 'in' | 'cm';
}

export interface PackageWeight {
  value: number;
  unit: 'lb' | 'oz' | 'kg' | 'g';
}

export interface ShippingAddress {
  name?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface RateQuoteRequest {
  from: ShippingAddress;
  to: ShippingAddress;
  weight: PackageWeight;
  dimensions?: PackageDimensions;
  serviceCode?: string;
  declaredValue?: number;
}

export interface RateQuote {
  carrier: CarrierCode;
  serviceCode: string;
  serviceName: string;
  totalCost: number;
  currency: string;
  estimatedDays?: number;
  raw: unknown;
}
