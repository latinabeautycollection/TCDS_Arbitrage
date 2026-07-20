export interface ExistingCarrierDecision {
  carrierCode: string;
  serviceCode: string;
  score?: number;
  reasonCodes?: string[];
}

export class ExistingCarrierEngineAdapter {
  normalize(decision: ExistingCarrierDecision): ExistingCarrierDecision {
    return {
      carrierCode: decision.carrierCode.toUpperCase(),
      serviceCode: decision.serviceCode,
      score: decision.score ?? 50,
      reasonCodes: decision.reasonCodes ?? []
    };
  }
}
