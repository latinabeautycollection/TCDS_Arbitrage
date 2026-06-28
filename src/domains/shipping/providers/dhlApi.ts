import { DhlClient } from "./dhlClient";
import { getDhlEnv } from "../config/dhlEnv";
import { dhlLocationAddressSchema, dhlReturnLabelSchema, dhlTrackInputSchema, dhlWebhookSubscriptionSchema } from "../validators/dhlValidators";

export class DhlApi {
  private readonly env = getDhlEnv();

  constructor(private readonly client = new DhlClient()) {}

  healthCheck() {
    return this.client.healthCheck();
  }

  track(input: unknown) {
    const parsed = dhlTrackInputSchema.parse(input);
    return this.client.getTracking("/shipments", {
      trackingNumber: parsed.trackingNumber,
      service: parsed.service,
      requesterCountryCode: parsed.requesterCountryCode,
      originCountryCode: parsed.originCountryCode,
      recipientPostalCode: parsed.recipientPostalCode,
      language: parsed.language ?? this.env.DHL_TRACKING_DEFAULT_LANGUAGE,
      offset: parsed.offset ?? 0,
      limit: parsed.limit ?? this.env.DHL_TRACKING_DEFAULT_LIMIT,
    });
  }

  createWebhook(input: unknown) {
    return this.client.postEcommerce("/account/v4/webhooks", dhlWebhookSubscriptionSchema.parse(input));
  }

  listWebhooks() {
    return this.client.getEcommerce("/account/v4/webhooks");
  }

  getWebhook(hookId: string) {
    return this.client.getEcommerce(`/account/v4/webhooks/${encodeURIComponent(hookId)}`);
  }

  updateWebhook(hookId: string, input: unknown) {
    return this.client.putEcommerce(`/account/v4/webhooks/${encodeURIComponent(hookId)}`, dhlWebhookSubscriptionSchema.parse(input));
  }

  deleteWebhook(hookId: string) {
    return this.client.deleteEcommerce(`/account/v4/webhooks/${encodeURIComponent(hookId)}`);
  }

  createReturnLabel(input: unknown) {
    const parsed = dhlReturnLabelSchema.parse(input);
    return this.client.postEcommerce("/returns/v4/label", parsed);
  }

  getReturnLabel(pickup: string, query: Record<string, unknown> = {}) {
    return this.client.getEcommerce(`/returns/v4/label/${encodeURIComponent(pickup)}`, query);
  }

  findLocationsByAddress(input: unknown) {
    return this.client.getLocation("/find-by-address", dhlLocationAddressSchema.parse(input));
  }

  findLocationsByGeo(input: Record<string, unknown>) {
    return this.client.getLocation("/find-by-geo", input);
  }

  getLocation(locationId: string) {
    return this.client.getLocation(`/locations/${encodeURIComponent(locationId)}`);
  }

  freightPriceQuote(input: unknown) {
    return this.client.postFreightPriceQuote(input);
  }

  freightBooking(input: unknown) {
    return this.client.postFreightBooking(input);
  }
}
