import { fetchJson } from '../../utils/fetchJson';

export class EbayAuthClient {
  constructor(private clientId = process.env.EBAY_CLIENT_ID || '', private clientSecret = process.env.EBAY_CLIENT_SECRET || '', private refreshToken = process.env.EBAY_REFRESH_TOKEN || '', private env = process.env.EBAY_ENV || 'production') {}
  private base() { return this.env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'; }
  async getAccessToken(scopes = ['https://api.ebay.com/oauth/api_scope/sell.inventory']): Promise<string> {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) throw new Error('Missing eBay OAuth env');
    const body = new URLSearchParams({ grant_type:'refresh_token', refresh_token:this.refreshToken, scope:scopes.join(' ') });
    const res = await fetch(`${this.base()}/identity/v1/oauth2/token`, { method:'POST', headers:{ authorization:`Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'content-type':'application/x-www-form-urlencoded' }, body });
    const payload:any = await res.json();
    if (!res.ok) throw new Error(`eBay OAuth failed: ${JSON.stringify(payload)}`);
    return payload.access_token;
  }
}
