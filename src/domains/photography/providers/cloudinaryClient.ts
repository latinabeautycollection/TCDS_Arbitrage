export class CloudinaryClient {
  enabled() { return false; }
  async upload(_buffer: Buffer, _key: string): Promise<string> { throw new Error('Cloudinary upload not configured in this package; use PhotoStorageService local or wire official SDK.'); }
}
