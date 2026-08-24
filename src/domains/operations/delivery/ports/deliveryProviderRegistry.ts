import type { EmailDeliveryPort } from "./emailDeliveryPort";
import type { SmsDeliveryPort } from "./smsDeliveryPort";

export interface DeliveryProviderRegistry {
  email: EmailDeliveryPort;
  sms: SmsDeliveryPort;
}

let registry: DeliveryProviderRegistry | undefined;

export function configureDeliveryProviderRegistry(value: DeliveryProviderRegistry): void {
  if (registry) throw new Error("Domain 10C provider registry already configured");
  registry = value;
}

export function deliveryProviderRegistry(): DeliveryProviderRegistry {
  if (!registry) {
    throw new Error("Domain 10C provider registry has not been configured by the production composition root");
  }
  return registry;
}
