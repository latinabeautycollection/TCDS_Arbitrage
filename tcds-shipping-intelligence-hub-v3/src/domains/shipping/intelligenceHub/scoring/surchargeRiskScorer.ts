export function scoreSurchargeRisk(input: {
  residential: boolean;
  remoteArea: boolean;
  dimensionsVerified: boolean;
  weightVerified: boolean;
}): number {
  return Math.min(100,
    (input.residential ? 15 : 0) +
    (input.remoteArea ? 30 : 0) +
    (!input.dimensionsVerified ? 30 : 0) +
    (!input.weightVerified ? 25 : 0)
  );
}
