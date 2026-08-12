import { EMAIL_POLICY } from "../config/emailPolicyConfig";
import {
  recipientAuthorized,
  resolveAudience
} from "../repositories/recipientAuthorizationRepository";
import type { EmailRecipient, NotificationRequest } from "../models/emailTypes";

export async function resolveAndAuthorizeRecipients(req:NotificationRequest):Promise<EmailRecipient[]> {
  if (!EMAIL_POLICY.permittedClassifications.has(req.classification)) {
    throw new Error(`Classification ${req.classification} is forbidden for email`);
  }
  if (Boolean(req.recipients?.length) === Boolean(req.audienceKey)) {
    throw new Error("Provide exactly one of recipients or audienceKey");
  }

  const recipients = req.audienceKey ? await resolveAudience(req.audienceKey) : (req.recipients ?? []);
  if (!recipients.length) throw new Error("Notification has no authorized recipients");

  const deduped = [...new Map(
    recipients.map(r => [r.address.trim().toLowerCase(), {...r,address:r.address.trim().toLowerCase()}])
  ).values()];

  for (const r of deduped) {
    if (!await recipientAuthorized(r.address,req.eventType,req.classification)) {
      throw new Error(`Recipient is not authorized for event/classification: ${r.address}`);
    }
  }
  return deduped;
}
