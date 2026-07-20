import type { AddressInput } from "../models/intelligenceContext";

export interface AddressValidationResult {
  valid: boolean;
  normalized?: AddressInput;
  residential?: boolean;
  deliveryPointValidated?: boolean;
  classifications?: string[];
  warnings: string[];
  raw?: Record<string, unknown>;
}

export interface AddressValidationGateway {
  validate(address: AddressInput, correlationId: string): Promise<AddressValidationResult>;
}
