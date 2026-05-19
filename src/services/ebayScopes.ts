export const EbayScopes = {
  PUBLIC: "https://api.ebay.com/oauth/api_scope",
  BUY_BROWSE: "https://api.ebay.com/oauth/api_scope/buy.browse",
  SELL_INVENTORY: "https://api.ebay.com/oauth/api_scope/sell.inventory",
  SELL_ACCOUNT: "https://api.ebay.com/oauth/api_scope/sell.account",
  SELL_FULFILLMENT: "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  SELL_ANALYTICS: "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
} as const;

export type EbayScope = (typeof EbayScopes)[keyof typeof EbayScopes];

export function parseScopeString(scope?: string | null): Set<string> {
  if (!scope) return new Set();
  return new Set(
    scope
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function ensureScopesPresent(tokenScope: string | null | undefined, requiredScopes: string[]) {
  const granted = parseScopeString(tokenScope);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));

  if (missing.length > 0) {
    throw new Error(`Missing required eBay scopes: ${missing.join(", ")}`);
  }
}
