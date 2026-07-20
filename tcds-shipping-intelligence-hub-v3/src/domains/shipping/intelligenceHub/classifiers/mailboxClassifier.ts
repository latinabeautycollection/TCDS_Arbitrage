import type { AddressInput } from "../models/intelligenceContext";
import type { MailboxClass } from "../models/destinationIntelligence";

const normalize = (value?: string): string =>
  (value ?? "").toUpperCase().replace(/[.,#-]/g, " ").replace(/\s+/g, " ").trim();

export function classifyMailbox(address: AddressInput): MailboxClass {
  const joined = normalize(`${address.company ?? ""} ${address.line1} ${address.line2 ?? ""}`);
  if (/\b(P O BOX|PO BOX|POST OFFICE BOX)\b/.test(joined)) return "PO_BOX";
  if (/\b(PMB|PRIVATE MAILBOX|COMMERCIAL MAIL RECEIVING|CMRA)\b/.test(joined)) return "CMRA";
  if (/\b(UPS STORE|MAIL BOXES ETC|VIRTUAL MAILBOX)\b/.test(joined)) return "PRIVATE_MAILBOX";
  if (/\b(FREIGHT FORWARD|FORWARDING AGENT|CARGO FORWARD)\b/.test(joined)) return "FREIGHT_FORWARDER";
  if (/\b(RESHIP|RE SHIP|PACKAGE FORWARD)\b/.test(joined)) return "RESHIPPER";
  if (/^(APO|FPO|DPO)$/i.test(address.city.trim())) return "MILITARY_MAIL";
  return "PHYSICAL";
}
