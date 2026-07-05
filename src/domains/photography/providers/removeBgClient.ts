import { request } from 'undici';
import { loadPhotographyEnv } from '../config/photographyEnv';
export class RemoveBgClient {
  constructor(private env = loadPhotographyEnv()) {}
  enabled() { return !!this.env.REMOVEBG_API_KEY; }
  async removeBackground(buffer: Buffer): Promise<Buffer> {
    if (!this.env.REMOVEBG_API_KEY) throw new Error('remove.bg disabled');
    const form = new FormData(); form.append('image_file', new Blob([new Uint8Array(buffer)]), 'image.jpg'); form.append('size','auto');
    const resp = await request('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': this.env.REMOVEBG_API_KEY }, body: form as any });
    if (resp.statusCode >= 300) throw new Error(`remove.bg failed ${resp.statusCode}`);
    return Buffer.from(await resp.body.arrayBuffer());
  }
}
