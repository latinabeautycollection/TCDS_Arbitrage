import fs from 'node:fs';
import crypto from 'node:crypto';

export class CredentialRotation {
  static fingerprint(path: string): string {
    const buf = fs.readFileSync(path);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
  static assertSecureFile(path: string): { ok: boolean; reason?: string } {
    const stat = fs.statSync(path);
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) return { ok: false, reason: `Credential file permissions too broad: ${mode.toString(8)}. Use 600 or 640.` };
    return { ok: true };
  }
}
