import { CarrierAdapter, CarrierCode } from "./carrierAdapter";
import { ShipEngineCarrierAdapter } from "./shipEngineCarrierAdapter";

export class CarrierFactory {
  private readonly adapters = new Map<CarrierCode, CarrierAdapter>();

  constructor() {
    this.register(new ShipEngineCarrierAdapter());
  }

  register(adapter: CarrierAdapter) {
    this.adapters.set(adapter.carrierCode, adapter);
  }

  get(carrierCode: CarrierCode): CarrierAdapter {
    const adapter = this.adapters.get(carrierCode);
    if (!adapter) throw new Error(`Carrier adapter not registered: ${carrierCode}`);
    return adapter;
  }

  list(): CarrierAdapter[] {
    return [...this.adapters.values()];
  }
}
