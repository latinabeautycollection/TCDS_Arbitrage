import { fetchJson } from '../../utils/fetchJson';
import { EbayAuthClient } from './ebayAuthClient';

export class EbayInventoryClient {
  constructor(private auth = new EbayAuthClient(), private env = process.env.EBAY_ENV || 'production', private marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US') {}
  private base() { return this.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'; }
  private async headers() { return { authorization:`Bearer ${await this.auth.getAccessToken(['https://api.ebay.com/oauth/api_scope/sell.inventory'])}`, 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId, 'content-language':'en-US' }; }
  async createOrReplaceInventoryItem(sku: string, payload: unknown): Promise<unknown> { return fetchJson(`${this.base()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method:'PUT', headers: await this.headers(), body: payload }); }
  async createOffer(payload: unknown): Promise<{ offerId: string }> { return fetchJson(`${this.base()}/sell/inventory/v1/offer`, { method:'POST', headers: await this.headers(), body: payload }); }
  async publishOffer(offerId: string): Promise<{ listingId: string }> { return fetchJson(`${this.base()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, { method:'POST', headers: await this.headers(), body: {} }); }
  async getListingFees(offerId: string): Promise<unknown> { return fetchJson(`${this.base()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/get_listing_fees`, { method:'POST', headers: await this.headers(), body: {} }); }
}
