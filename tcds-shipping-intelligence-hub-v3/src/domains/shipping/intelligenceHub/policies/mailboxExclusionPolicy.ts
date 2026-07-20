import type { MailboxClass } from "../models/destinationIntelligence";

const BLOCKED = new Set<MailboxClass>([
  "PO_BOX", "CMRA", "PRIVATE_MAILBOX", "FREIGHT_FORWARDER", "RESHIPPER"
]);

export function evaluateMailboxEligibility(mailboxClass: MailboxClass): {
  eligible: boolean;
  reasonCodes: string[];
} {
  return BLOCKED.has(mailboxClass)
    ? { eligible: false, reasonCodes: [`PROHIBITED_${mailboxClass}`] }
    : { eligible: true, reasonCodes: [] };
}
