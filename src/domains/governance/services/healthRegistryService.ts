import { assertNoSensitiveKeys } from "../validators/healthValidators";
import { HealthRegistryRepository } from "../repositories/healthRegistryRepository";
import type { ComponentRegistrationInput, DependencyRegistrationInput, HealthCheckDefinition } from "../models/healthTypes";

export class HealthRegistryService {
  constructor(private readonly repository: HealthRegistryRepository) {}
  registerComponent(input: ComponentRegistrationInput) { return this.repository.registerComponent(input); }
  registerDependency(input: DependencyRegistrationInput) {
    if ((input.providerComponentId == null) === (input.externalDependencyCode == null)) {
      throw new Error("Exactly one providerComponentId or externalDependencyCode is required");
    }
    return this.repository.registerDependency(input);
  }
  createDefinition(input: Omit<HealthCheckDefinition,"id">) {
    assertNoSensitiveKeys(input.configuration);
    if (input.mode === "PULL" && (!input.intervalSeconds || !input.timeoutMs)) throw new Error("PULL definitions require intervalSeconds and timeoutMs");
    return this.repository.createDefinition(input);
  }
  activateDefinition(componentId: string, checkCode: string, definitionId: string) {
    return this.repository.activateDefinition(componentId,checkCode,definitionId);
  }
  bindDependency(definitionId: string, componentId: string, dependencyId: string, role?: "PRIMARY"|"SUPPORTING") {
    return this.repository.bindDependency(definitionId,componentId,dependencyId,role);
  }
  authorizePushPrincipal(definitionId: string, componentId: string, principalId: string, producerComponentId?: string) {
    return this.repository.authorizePushPrincipal(definitionId,componentId,principalId,producerComponentId);
  }
  revokePushAuthority(authorityId: string, reason: string) { return this.repository.revokePushAuthority(authorityId,reason); }

}
