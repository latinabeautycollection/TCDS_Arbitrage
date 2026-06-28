import { UpsClient } from "./upsClient";
import { getUpsEnv } from "../config/upsEnv";
import { upsAddressValidationInputSchema, upsRateShopInputSchema, upsSubscriptionSchema, upsTrackingNumberSchema } from "../validators/upsValidators";
export class UpsApi { private readonly env = getUpsEnv(); constructor(private readonly client = new UpsClient()) {}
  healthCheck(){ return this.client.healthCheck(); }
  validateAddress(input: unknown){ const p=upsAddressValidationInputSchema.parse(input); return this.client.postJson(`/addressvalidation/${this.env.UPS_ADDRESS_VALIDATION_VERSION}/${this.env.UPS_ADDRESS_VALIDATION_REQUEST_OPTION}`, { XAVRequest:{ AddressKeyFormat:{ ConsigneeName:p.consigneeName, AddressLine:p.addressLine, PoliticalDivision2:p.city, PoliticalDivision1:p.stateProvinceCode, PostcodePrimaryLow:p.postalCode, CountryCode:p.countryCode } } }); }
  timeInTransit(input: unknown){ const p=upsRateShopInputSchema.parse(input); return this.client.postJson(`/shipments/${this.env.UPS_TIME_IN_TRANSIT_VERSION}/transittimes`, { originCountryCode:p.originCountryCode, originPostalCode:p.originPostalCode, destinationCountryCode:p.destinationCountryCode, destinationPostalCode:p.destinationPostalCode, residentialIndicator:p.residentialIndicator ?? this.env.UPS_DEFAULT_RESIDENTIAL_INDICATOR, weight:p.weight, weightUnitOfMeasure:this.env.UPS_DEFAULT_WEIGHT_UNIT, numberOfPackages:1 }); }
  createShipment(input: unknown){ return this.client.postJson(`/shipments/${this.env.UPS_SHIP_VERSION}/ship`, input); }
  voidShipment(shipmentIdentificationNumber: string, trackingNumber?: string){ return this.client.deleteJson(`/shipments/${this.env.UPS_VOID_VERSION}/void/cancel/${encodeURIComponent(shipmentIdentificationNumber)}`, trackingNumber ? { trackingnumber: trackingNumber } : {}); }
  labelRecovery(input: unknown){ return this.client.postJson(`/labels/${this.env.UPS_LABEL_RECOVERY_VERSION}/recovery`, input); }
  track(inquiryNumber: string, options: { returnSignature?: boolean; returnMilestones?: boolean; returnPOD?: boolean } = {}){ const n=upsTrackingNumberSchema.parse(inquiryNumber); return this.client.getJson(`/track/v1/details/${encodeURIComponent(n)}`, { locale:this.env.UPS_LOCALE, returnSignature:String(Boolean(options.returnSignature)), returnMilestones:String(Boolean(options.returnMilestones ?? true)), returnPOD:String(Boolean(options.returnPOD ?? true)) }); }
  trackByReference(referenceNumber: string, query: Record<string, unknown> = {}){ return this.client.getJson(`/track/v1/reference/details/${encodeURIComponent(referenceNumber)}`, { locale:this.env.UPS_LOCALE, ...query }); }
  subscribeTracking(input: unknown){ return this.client.postJson(`/track/${this.env.UPS_TRACK_SUBSCRIPTION_VERSION}/subscription/standard/package`, upsSubscriptionSchema.parse(input)); }
  locator(input: unknown, reqOption='64'){ return this.client.postJson(`/locations/v3/search/availabilities/${reqOption}`, input, { Locale:this.env.UPS_LOCALE }); }
}
