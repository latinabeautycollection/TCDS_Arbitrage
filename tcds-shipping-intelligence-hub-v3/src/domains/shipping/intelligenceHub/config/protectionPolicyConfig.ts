export const protectionPolicyConfig = {
  insuranceThresholdUsd: 100,
  deliveryConfirmationThresholdUsd: 250,
  directSignatureThresholdUsd: 250,
  ebayMandatorySignatureThresholdUsd: 750,
  restrictedDeliveryThresholdUsd: 1000,
  highFraudElectronicsSignatureThresholdUsd: 250,
  insureAtSalePrice: true,
  requireTamperEvidenceAtUsd: 250,
  requireSerialCaptureAtUsd: 100,
  requireDigitalWeightAuditAtUsd: 250
} as const;
