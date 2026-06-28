import { UspsClient } from "./uspsClient";
export class UspsApi {
  constructor(private readonly client = new UspsClient()) {}
  healthCheck() { return this.client.healthCheck(); }
  standardizeAddress(input: any) { return this.client.getJson("/addresses/v3/address", input); }
  cityState(input: any) { return this.client.getJson("/addresses/v3/city-state", input); }
  zipcode(input: any) { return this.client.getJson("/addresses/v3/zipcode", input); }
  baseRatesSearch(input: any) { return this.client.postJson("/prices/v3/base-rates/search", input); }
  baseRatesListSearch(input: any) { return this.client.postJson("/prices/v3/base-rates-list/search", input); }
  extraServiceRatesSearch(input: any) { return this.client.postJson("/prices/v3/extra-service-rates/search", input); }
  totalRatesSearch(input: any) { return this.client.postJson("/prices/v3/total-rates/search", input); }
  letterRatesSearch(input: any) { return this.client.postJson("/prices/v3/letter-rates/search", input); }
  shippingOptionsSearch(input: any) { return this.client.postJson("/shipping-options/v3/options/search", input); }
  tracking(input: any) { return this.client.postJson("/tracking/v3/tracking", input); }
  registerNotifications(trackingNumber: string, input: any) { return this.client.postJson(`/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}/notifications`, input); }
  requestProofOfDelivery(trackingNumber: string, input: any) { return this.client.postJson(`/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}/proof-of-delivery`, input); }
}
