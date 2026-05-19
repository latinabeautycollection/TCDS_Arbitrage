import { env } from "./env";

export type EbayEnvironment = "production" | "sandbox";

export function getEbayConfig(environment: EbayEnvironment) {
  if (environment === "production") {
    return {
      environment,
      clientId: env.EBAY_PROD_CLIENT_ID,
      clientSecret: env.EBAY_PROD_CLIENT_SECRET,
      runame: env.EBAY_PROD_RUNAME,
      authUrl: env.EBAY_PROD_AUTH_URL,
      tokenUrl: env.EBAY_PROD_TOKEN_URL,
      baseUrl: env.EBAY_PROD_BASE_URL,
      scopes: env.EBAY_PROD_SCOPES,
    };
  }

  return {
    environment,
    clientId: env.EBAY_SANDBOX_CLIENT_ID,
    clientSecret: env.EBAY_SANDBOX_CLIENT_SECRET,
    runame: env.EBAY_SANDBOX_RUNAME,
    authUrl: env.EBAY_SANDBOX_AUTH_URL,
    tokenUrl: env.EBAY_SANDBOX_TOKEN_URL,
    baseUrl: env.EBAY_SANDBOX_BASE_URL,
    scopes: env.EBAY_SANDBOX_SCOPES,
  };
}
