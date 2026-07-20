import type { ShippingDigitalTwin } from "../models/shippingDigitalTwin";
export interface DigitalTwinGateway { getBySku(sku:string):Promise<ShippingDigitalTwin|undefined>; save(twin:ShippingDigitalTwin):Promise<void>; }
