import sharp from 'sharp';
import { loadPhotographyEnv } from '../config/photographyEnv';
import { RemoveBgClient } from '../providers/removeBgClient';
import { PhotoRoomClient } from '../providers/photoRoomClient';
import type { BackgroundProviderName } from '../models/photoTypes';
export class BackgroundRemovalEngine {
  constructor(private env = loadPhotographyEnv(), private removeBg = new RemoveBgClient(env), private photoRoom = new PhotoRoomClient(env)) {}
  async process(buffer: Buffer, providerPreference: BackgroundProviderName = 'local') {
    const chain: any[] = [];
    if (this.env.PHOTO_ENABLE_EXTERNAL_BACKGROUND_REMOVAL && providerPreference === 'photoroom' && this.photoRoom.enabled()) { chain.push({ op:'background_remove', provider:'photoroom' }); return { buffer: await this.photoRoom.removeBackground(buffer), chain }; }
    if (this.env.PHOTO_ENABLE_EXTERNAL_BACKGROUND_REMOVAL && providerPreference === 'removebg' && this.removeBg.enabled()) { chain.push({ op:'background_remove', provider:'removebg' }); return { buffer: await this.removeBg.removeBackground(buffer), chain }; }
    const out = await sharp(buffer).flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true, background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    chain.push({ op:'flatten_resize', provider:'local_sharp' }); return { buffer: out, chain };
  }
}
