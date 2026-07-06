import { request } from 'undici';
import { loadPhotographyEnv } from '../config/photographyEnv';
export class PhotoRoomClient {
  constructor(private env = loadPhotographyEnv()) {}
  enabled() { return !!this.env.PHOTOROOM_API_KEY; }
  async removeBackground(buffer: Buffer): Promise<Buffer> {
    if (!this.env.PHOTOROOM_API_KEY) throw new Error('PhotoRoom disabled');
    const form = new FormData(); form.append('image_file', new Blob([new Uint8Array(buffer)]), 'image.jpg'); form.append('format', 'jpg');
    const resp = await request('https://sdk.photoroom.com/v1/segment', { method: 'POST', headers: { 'x-api-key': this.env.PHOTOROOM_API_KEY }, body: form as any });
    if (resp.statusCode >= 300) throw new Error(`PhotoRoom failed ${resp.statusCode}`);
    return Buffer.from(await resp.body.arrayBuffer());
  }
}
