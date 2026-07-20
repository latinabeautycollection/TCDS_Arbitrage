export interface ShippingIntelligenceFeatureFlags {
  zoneProtection: boolean;
  thirdPartyInsurance: boolean;
  fraudScoring: boolean;
  weatherScoring: boolean;
  carrierLearning: boolean;
  profitBlocking: boolean;
  mailboxBlocking: boolean;
  serviceCommitmentVerification: boolean;
  digitalWeightAudit: boolean;
}

export const defaultFeatureFlags: ShippingIntelligenceFeatureFlags = {
  zoneProtection: true,
  thirdPartyInsurance: true,
  fraudScoring: true,
  weatherScoring: false,
  carrierLearning: true,
  profitBlocking: false,
  mailboxBlocking: true,
  serviceCommitmentVerification: true,
  digitalWeightAudit: true
};
