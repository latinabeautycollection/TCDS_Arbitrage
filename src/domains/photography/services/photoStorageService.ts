import fs from 'fs/promises'; import path from 'path'; import sharp from 'sharp'; import { loadPhotographyEnv } from '../config/photographyEnv'; import { sha256 } from '../utils/hash';
export class PhotoStorageService {
  constructor(private env = loadPhotographyEnv()) {}
  private async ensure(dir:string){ await fs.mkdir(dir,{recursive:true}); }
  async store(buffer: Buffer, kind: 'original'|'processed'|'thumbnail', ext='jpg') {
    const hash = sha256(buffer); const dir = path.join(this.env.PHOTO_STORAGE_ROOT, kind, hash.slice(0,2), hash.slice(2,4)); await this.ensure(dir);
    const file = path.join(dir, `${hash}.${ext}`); await fs.writeFile(file, buffer); return { uri: this.publicUri(file), path: file, sha256: hash };
  }
  async thumbnail(buffer: Buffer) { return sharp(buffer).resize({ width: 320, height: 320, fit:'inside', withoutEnlargement:true }).jpeg({ quality:82 }).toBuffer(); }
  private publicUri(file:string){ return this.env.PHOTO_PUBLIC_BASE_URL ? `${this.env.PHOTO_PUBLIC_BASE_URL}/${path.relative(this.env.PHOTO_STORAGE_ROOT,file).replace(/\\/g,'/')}` : file; }
}
