export class RemoveBgClient {
  constructor(private apiKey = process.env.REMOVEBG_API_KEY || '') {}
  async removeBackground(imageUrl: string): Promise<{ cleanedUrl?: string; provider: 'REMOVEBG'; success: boolean; error?: string }> {
    if (!this.apiKey) return { provider:'REMOVEBG', success:false, error:'REMOVEBG_API_KEY_MISSING' };
    return { provider:'REMOVEBG', success:false, error:'REMOVEBG_ENDPOINT_NOT_CONFIGURED', cleanedUrl: imageUrl };
  }
}
