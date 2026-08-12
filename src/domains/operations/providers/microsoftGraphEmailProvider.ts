import { randomUUID } from "node:crypto";
import {
  ClientCertificateCredential,
  ClientSecretCredential,
  type TokenCredential
} from "@azure/identity";
import { emailEnv } from "../config/emailEnv";
import { EmailProviderError } from "../errors/EmailProviderError";
import type { GraphSendRequest, GraphSendResult } from "../models/emailTypes";

type FetchLike = typeof fetch;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30 * 60 * 1000);
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 30 * 60 * 1000));
  return undefined;
}

function cleanErrorMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 1000);
}

export class MicrosoftGraphEmailProvider {
  private readonly env = emailEnv();
  private readonly credential: TokenCredential;

  constructor(private readonly fetchImpl: FetchLike = fetch, credential?: TokenCredential) {
    this.credential = credential ?? (
      this.env.M365_AUTH_MODE === "certificate"
        ? new ClientCertificateCredential(
            this.env.M365_TENANT_ID,
            this.env.M365_CLIENT_ID,
            this.env.M365_CERTIFICATE_PATH!
          )
        : new ClientSecretCredential(
            this.env.M365_TENANT_ID,
            this.env.M365_CLIENT_ID,
            this.env.M365_CLIENT_SECRET!
          )
    );
  }

  /** Token acquisition only; this does not prove Mail.Send authorization. */
  async authenticationHealthCheck(): Promise<boolean> {
    if (!this.env.DOMAIN10_EMAIL_ENABLED) return false;
    const token = await this.credential.getToken("https://graph.microsoft.com/.default");
    return Boolean(token?.token);
  }

  /**
   * Exactly one provider submission attempt.
   * No nested retry loop. Durable retry orchestration belongs to the worker.
   */
  async send(req: GraphSendRequest): Promise<GraphSendResult> {
    let token;
    try {
      token = await this.credential.getToken("https://graph.microsoft.com/.default");
    } catch (cause) {
      throw new EmailProviderError(
        "Microsoft Entra authentication failed",
        "AUTHENTICATION", false, false, undefined, undefined, undefined, {cause}
      );
    }
    if (!token?.token) {
      throw new EmailProviderError("Microsoft Entra returned no access token","AUTHENTICATION",false,false);
    }

    const clientRequestId = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.env.DOMAIN10_EMAIL_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.env.M365_GRAPH_BASE_URL}/users/${encodeURIComponent(this.env.M365_ALERT_FROM)}/sendMail`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "client-request-id": clientRequestId,
            "return-client-request-id": "true"
          },
          body: JSON.stringify({
            message: {
              subject: req.subject,
              importance: req.importance,
              body: { contentType: "HTML", content: req.htmlBody },
              toRecipients: req.to.map(r => ({emailAddress:{address:r.address,...(r.name?{name:r.name}:{})}})),
              bccRecipients: (req.bcc ?? []).map(r => ({emailAddress:{address:r.address,...(r.name?{name:r.name}:{})}})),
              replyTo: [{emailAddress:{address:this.env.M365_REPLY_TO}}],
              internetMessageHeaders: [
                {name:"x-tcds-event-id",value:req.eventId},
                {name:"x-tcds-notification-id",value:req.notificationId},
                {name:"x-tcds-correlation-id",value:req.correlationId},
                {name:"x-tcds-delivery-id",value:req.deliveryId},
                {name:"x-tcds-attempt-id",value:req.attemptId},
                ...(req.incidentId ? [{name:"x-tcds-incident-id",value:req.incidentId}] : [])
              ]
            },
            saveToSentItems: true
          })
        }
      );
    } catch (cause) {
      const timeout = cause instanceof DOMException && cause.name === "AbortError";
      // Once HTTP submission has begun, no response can prove whether Exchange accepted the request.
      throw new EmailProviderError(
        timeout ? "Microsoft Graph sendMail timed out" : "Microsoft Graph network failure",
        timeout ? "TIMEOUT" : "NETWORK",
        false,
        true,
        undefined, undefined, undefined, {cause}
      );
    } finally {
      clearTimeout(timer);
    }

    const providerRequestId = response.headers.get("request-id") ?? undefined;

    if (response.status === 202) {
      return {accepted:true,httpStatus:202,providerRequestId,providerClientRequestId:clientRequestId};
    }

    // sendMail documents 202 as the success contract. Treat any other 2xx as unexpected protocol behavior.
    if (response.ok) {
      throw new EmailProviderError(
        `Unexpected Microsoft Graph sendMail success status ${response.status}`,
        "PROTOCOL", false, false, response.status
      );
    }

    let code: string | undefined;
    let message = `Microsoft Graph returned HTTP ${response.status}`;
    try {
      const body = await response.json() as {error?:{code?:string;message?:string}};
      code = body.error?.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Never surface raw response bodies into logs.
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const retryable = [408,429,500,502,503,504].includes(response.status);
    const failure =
      response.status === 401 ? "AUTHENTICATION" :
      response.status === 403 ? "AUTHORIZATION" :
      response.status === 429 ? "THROTTLED" :
      response.status >= 500 ? "PROVIDER_5XX" : "INVALID_REQUEST";

    throw new EmailProviderError(
      cleanErrorMessage(message),
      failure,
      retryable,
      false,
      response.status,
      code,
      retryAfterMs
    );
  }
}
