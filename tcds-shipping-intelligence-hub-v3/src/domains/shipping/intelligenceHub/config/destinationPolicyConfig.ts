export const destinationPolicyConfig = {
  contiguousMaxTransitBusinessDays: 2,
  extendedDestinationMinTransitBusinessDays: 5,
  extendedDestinationMaxTransitBusinessDays: 7,
  prohibitedMailboxClasses: [
    "PO_BOX", "CMRA", "PRIVATE_MAILBOX", "FREIGHT_FORWARDER", "RESHIPPER"
  ] as const,
  extendedDestinationClasses: [
    "ALASKA", "HAWAII", "PUERTO_RICO", "USVI", "GUAM", "CANADA"
  ] as const,
  militaryMailAction: "MANUAL_REVIEW" as const,
  internationalPolicy: "EBAY_INTERNATIONAL_SHIPPING_ONLY" as const
};
