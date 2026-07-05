import sharp from 'sharp';
import { sha256 } from './hash';

export async function getImageMetadata(buffer: Buffer) {
  const img = sharp(buffer, { failOn: 'none' });
  const meta = await img.metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0, mimeType: `image/${meta.format ?? 'jpeg'}`, fileSizeBytes: buffer.length, exif: { orientation: meta.orientation, density: meta.density, format: meta.format }, sha256: sha256(buffer), perceptualHash: await averageHash(buffer) };
}

export async function luminanceStats(buffer: Buffer) {
  const raw = await sharp(buffer).greyscale().resize(128,128,{fit:'fill'}).raw().toBuffer();
  const values = Array.from(raw); const mean = values.reduce((a,b)=>a+b,0)/values.length;
  const variance = values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;
  return { mean, variance, stddev: Math.sqrt(variance), darkRatio: values.filter(v=>v<35).length/values.length, lightRatio: values.filter(v=>v>235).length/values.length };
}

export async function averageHash(buffer: Buffer): Promise<string> {
  const raw = await sharp(buffer).greyscale().resize(8,8,{fit:'fill'}).raw().toBuffer();
  const avg = Array.from(raw).reduce((a,b)=>a+b,0)/64;
  return Array.from(raw).map(v => v >= avg ? '1' : '0').join('');
}

export async function laplacianSharpnessScore(buffer: Buffer): Promise<number> {
  const g = await sharp(buffer).greyscale().resize(256,256,{fit:'inside'}).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = g; const w = info.width; const h = info.height; const vals:number[]=[];
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const i=y*w+x; vals.push(Math.abs(4*data[i]!-data[i-1]!-data[i+1]!-data[i-w]!-data[i+w]!));
  }
  const mean = vals.reduce((a,b)=>a+b,0)/Math.max(1, vals.length);
  return Math.max(0, Math.min(100, mean*2.4));
}
