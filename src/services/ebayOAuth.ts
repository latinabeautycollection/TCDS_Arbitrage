import crypto from "crypto";
import { EbayEnvironment, getEbayConfig } from "../config/ebay";

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
  scope?: string;
};

function basicAuth(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function buildState(environment: EbayEnvironment) {
  return `${environment}:${crypto.randomBytes(24).toString("hex")}`;
}

export function buildConsentUrl(environment: EbayEnvironment, state: string) {
  const cfg = getEbayConfig(environment);
  const url = new URL(cfg.authUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.runame);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(environment: EbayEnvironment, code: string) {
  const cfg = getEbayConfig(environment);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.runame,
  });

  const response = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(cfg.clientId, cfg.clientSecret),
    },
    body,
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`eBay exchange failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return json as EbayTokenResponse;
}

export async function refreshAccessToken(environment: EbayEnvironment, refreshToken: string) {
  const cfg = getEbayConfig(environment);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(cfg.clientId, cfg.clientSecret),
    },
    body,
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`eBay refresh failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return json as EbayTokenResponse;
}
