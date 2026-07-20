export type DestinationClass =
  | "CONTIGUOUS_US"
  | "ALASKA"
  | "HAWAII"
  | "PUERTO_RICO"
  | "USVI"
  | "GUAM"
  | "APO_FPO_DPO"
  | "CANADA"
  | "INTERNATIONAL_OTHER"
  | "UNKNOWN";

export type MailboxClass =
  | "PHYSICAL"
  | "PO_BOX"
  | "CMRA"
  | "PRIVATE_MAILBOX"
  | "FREIGHT_FORWARDER"
  | "RESHIPPER"
  | "MILITARY_MAIL"
  | "UNKNOWN";

export interface DestinationIntelligence {
  destinationClass: DestinationClass;
  mailboxClass: MailboxClass;
  eligible: boolean;
  requiresSignatureByTerritory: boolean;
  economicServiceTargetDays?: { min: number; max: number };
  normalizedPostalCode: string;
  riskScore: number;
  fraudScore: number;
  remoteArea: boolean;
  residential: boolean;
  verifiedMarketplaceAddress: boolean;
  reasonCodes: string[];
}
