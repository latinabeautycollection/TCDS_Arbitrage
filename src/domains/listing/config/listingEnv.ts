export interface ListingEnv {
  databaseUrl: string;
  ebayEnv: 'production' | 'sandbox';
  ebayMarketplaceId: string;
  ebayClientId?: string;
  ebayClientSecret?: string;
  ebayRefreshToken?: string;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  photoRoomApiKey?: string;
  removeBgApiKey?: string;
  imageCleanupEnabled: boolean;
  autoPublishEnabled: boolean;
  requireHumanApproval: boolean;
}

export function getListingEnv(env = process.env): ListingEnv {
  return {
    databaseUrl: env.DATABASE_URL || '',
    ebayEnv: env.EBAY_ENV === 'sandbox' ? 'sandbox' : 'production',
    ebayMarketplaceId: env.EBAY_MARKETPLACE_ID || 'EBAY_US',
    ebayClientId: env.EBAY_CLIENT_ID,
    ebayClientSecret: env.EBAY_CLIENT_SECRET,
    ebayRefreshToken: env.EBAY_REFRESH_TOKEN,
    openAiApiKey: env.OPENAI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    photoRoomApiKey: env.PHOTOROOM_API_KEY,
    removeBgApiKey: env.REMOVEBG_API_KEY,
    imageCleanupEnabled: env.DOMAIN4_IMAGE_CLEANUP_ENABLED === 'true',
    autoPublishEnabled: env.DOMAIN4_AUTO_PUBLISH_ENABLED === 'true',
    requireHumanApproval: env.DOMAIN4_REQUIRE_HUMAN_APPROVAL !== 'false',
  };
}

export function assertListingEnv(e: ListingEnv): void {
  const missing = [] as string[];
  if (!e.databaseUrl) missing.push('DATABASE_URL');
  if (!e.ebayClientId) missing.push('EBAY_CLIENT_ID');
  if (!e.ebayClientSecret) missing.push('EBAY_CLIENT_SECRET');
  if (!e.openAiApiKey) missing.push('OPENAI_API_KEY');
  if (missing.length) throw new Error(`Domain4 listing env missing: ${missing.join(', ')}`);
}
