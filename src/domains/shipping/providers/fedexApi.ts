import { FedExClient } from "./fedexClient";

export class FedExApi {
  constructor(private readonly client = new FedExClient()) {}

  healthCheck() { return this.client.healthCheck(); }
  validateAddress(input: unknown) { return this.client.postJson("/address/v1/addresses/resolve", input); }
  rates(input: unknown) { return this.client.postJson("/rate/v1/rates/quotes", input); }
  serviceAvailability(input: unknown) { return this.client.postJson("/availability/v1/packageandserviceoptions", input); }
  createShipment(input: unknown) { return this.client.postJson("/ship/v1/shipments", input); }
  cancelShipment(input: unknown) { return this.client.postJson("/ship/v1/shipments/cancel", input); }
  track(input: unknown) { return this.client.postJson("/track/v1/trackingnumbers", input); }
  notifications(input: unknown) { return this.client.postJson("/track/v1/notifications", input); }
  proofOfDelivery(input: unknown) { return this.client.postJson("/track/v1/trackingdocuments", input); }
  returnTag(input: unknown) { return this.client.postJson("/ship/v1/shipments/tag", input); }
  pickupAvailability(input: unknown) { return this.client.postJson("/pickup/v1/pickupavailabilities", input); }
  createPickup(input: unknown) { return this.client.postJson("/pickup/v1/pickups", input); }
  cancelPickup(input: unknown) { return this.client.postJson("/pickup/v1/pickups/cancel", input); }
  claims(input: unknown) { return this.client.postJson("/claims/v1/claims", input); }
}
