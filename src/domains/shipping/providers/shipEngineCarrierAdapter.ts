import {
  CarrierAdapter,
  NormalizedAddressValidationResult,
  NormalizedCarrierHealth,
  NormalizedLabelResult,
  NormalizedRateResult,
  NormalizedTrackingResult,
} from "./carrierAdapter";
import { ShipEngineApi } from "./shipEngineApi";
import { mapShipEngineLabel, mapShipEngineRate, mapShipEngineTracking } from "../mappers/shipEngineMapper";

export class ShipEngineCarrierAdapter implements CarrierAdapter {
  carrierCode = "SHIPENGINE" as const;

  constructor(private readonly api = new ShipEngineApi()) {}

  async healthCheck(): Promise<NormalizedCarrierHealth> {
    const result: any = await this.api.healthCheck();
    return {
      carrierCode: this.carrierCode,
      ok: Boolean(result.ok),
      authOk: Boolean(result.apiKey),
      environment: result.environment,
      details: result,
    };
  }

  async validateAddress(input: unknown): Promise<NormalizedAddressValidationResult> {
    const response: any = await this.api.validateAddresses(input);
    const first = Array.isArray(response) ? response[0] : response;
    return {
      carrierCode: this.carrierCode,
      valid: ["verified", "valid"].includes(String(first?.status ?? "").toLowerCase()),
      cleanedAddress: first?.matched_address,
      messages: first?.messages ?? [],
      raw: response,
    };
  }

  async getRates(input: unknown): Promise<NormalizedRateResult[]> {
    const response: any = await this.api.getRates(input);
    const rates = response?.rate_response?.rates ?? response?.rates ?? [];
    return rates.map((rate: any) => {
      const mapped = mapShipEngineRate(rate);
      return {
        carrierCode: this.carrierCode,
        carrierId: mapped.carrierId,
        serviceCode: mapped.serviceCode,
        serviceName: mapped.serviceType,
        rateId: mapped.rateId,
        amount: mapped.shippingAmount,
        currency: mapped.shippingCurrency,
        deliveryDays: mapped.deliveryDays,
        trackable: mapped.trackable,
        raw: rate,
      };
    });
  }

  async createLabel(input: unknown): Promise<NormalizedLabelResult> {
    const response: any = await this.api.purchaseLabel(input);
    const mapped = mapShipEngineLabel(response);
    return {
      carrierCode: this.carrierCode,
      labelId: mapped.labelId,
      trackingNumber: mapped.trackingNumber,
      labelUrl: mapped.labelDownloadUrl,
      costAmount: mapped.shipmentCost.amount,
      currency: mapped.shipmentCost.currency,
      raw: response,
    };
  }

  async track(input: unknown): Promise<NormalizedTrackingResult> {
    const response: any = await this.api.track(input);
    const mapped = mapShipEngineTracking(response);
    return {
      carrierCode: this.carrierCode,
      trackingNumber: mapped.trackingNumber,
      statusCode: mapped.statusCode,
      statusDescription: mapped.statusDescription,
      estimatedDeliveryAt: mapped.estimatedDeliveryDate,
      deliveredAt: mapped.actualDeliveryDate,
      events: mapped.events,
      raw: response,
    };
  }

  async createReturnLabel(input: any): Promise<NormalizedLabelResult> {
    const response: any = await this.api.createReturnLabel(String(input.labelId), input.body ?? {});
    const mapped = mapShipEngineLabel(response);
    return {
      carrierCode: this.carrierCode,
      labelId: mapped.labelId,
      trackingNumber: mapped.trackingNumber,
      labelUrl: mapped.labelDownloadUrl,
      costAmount: mapped.shipmentCost.amount,
      currency: mapped.shipmentCost.currency,
      raw: response,
    };
  }

  voidLabel(input: any) {
    return this.api.voidLabel(String(input.labelId));
  }

  schedulePickup(input: unknown) {
    return this.api.schedulePickup(input);
  }

  createManifest(input: unknown) {
    return this.api.createManifest(input);
  }
}
