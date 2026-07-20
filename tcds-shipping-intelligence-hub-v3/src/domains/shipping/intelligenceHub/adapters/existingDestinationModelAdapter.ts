import type { AddressValidationGateway, AddressValidationResult } from "../contracts/addressValidationGateway";
import type { AddressInput } from "../models/intelligenceContext";

export interface ExistingDestinationModel {
  validateAddress(address: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class ExistingDestinationModelAdapter implements AddressValidationGateway {
  constructor(private readonly existing: ExistingDestinationModel) {}

  async validate(address: AddressInput, _correlationId: string): Promise<AddressValidationResult> {
    const raw = await this.existing.validateAddress(address as unknown as Record<string, unknown>);
    return {
      valid: Boolean(raw.valid ?? raw.isValid ?? true),
      normalized: (raw.normalizedAddress ?? raw.address ?? address) as AddressInput,
      residential: Boolean(raw.residential ?? address.residential ?? true),
      deliveryPointValidated: Boolean(raw.deliveryPointValidated ?? raw.dpv ?? false),
      classifications: Array.isArray(raw.classifications) ? raw.classifications.map(String) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
      raw
    };
  }
}
