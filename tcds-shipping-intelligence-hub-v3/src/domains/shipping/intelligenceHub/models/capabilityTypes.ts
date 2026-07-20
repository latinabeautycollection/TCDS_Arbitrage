export type CapabilityState="SUPPORTED"|"NOT_SUPPORTED"|"UNKNOWN";
export interface CarrierCapabilities { signature:CapabilityState; adultSignature:CapabilityState; restrictedDelivery:CapabilityState; carrierDeclaredValue:CapabilityState; saturdayDelivery:CapabilityState; pickupAvailable:CapabilityState; }
