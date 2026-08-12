import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';
import type { ResilienceEnv } from '../config/resilienceEnv';
import type { EncryptedBackup } from '../models/resilienceTypes';
import type { KeyManagementProvider } from './keyManagementProvider';

export class PostgresBackupProvider {
  constructor(private readonly env: ResilienceEnv, private readonly kms: KeyManagementProvider) {}

  private run(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        env: { ...process.env, PGAPPNAME: 'tcds-domain7i' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 65536); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`));
      });
    });
  }

  async createEncryptedBackup(outputBase: string, context: Readonly<Record<string, string>>): Promise<EncryptedBackup> {
    await fs.mkdir(this.env.FORENSIC_BACKUP_STAGING_DIR, { recursive: true, mode: 0o700 });
    const rawPath = `${outputBase}.dump`;
    const encryptedPath = `${outputBase}.dump.enc`;
    const envelope = await this.kms.generateDataKey(context);
    const iv = randomBytes(12);
    try {
      await this.run(this.env.PG_DUMP_PATH, [
        '--format=custom', '--no-owner', '--no-privileges', '--file', rawPath,
        this.env.FORENSIC_BACKUP_SOURCE_DATABASE_URL,
      ], this.env.FORENSIC_BACKUP_TIMEOUT_MS);

      const rawStat = await fs.stat(rawPath);
      if (rawStat.size <= 0 || rawStat.size > this.env.FORENSIC_BACKUP_MAX_BYTES) {
        throw new Error('Backup size outside policy');
      }

      const cipher = createCipheriv('aes-256-gcm', envelope.plaintextDataKey, iv);
      const hash = createHash('sha256');
      let bytes = 0;
      cipher.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
      await pipeline(createReadStream(rawPath), cipher, createWriteStream(encryptedPath, { mode: 0o600 }));
      const authTag = cipher.getAuthTag();

      const validationPath = `${outputBase}.validation.dump`;
      try {
        const decipher = createDecipheriv('aes-256-gcm', envelope.plaintextDataKey, iv);
        decipher.setAuthTag(authTag);
        await pipeline(createReadStream(encryptedPath), decipher, createWriteStream(validationPath, { mode: 0o600 }));
        await this.run(this.env.PG_RESTORE_PATH, ['--list', validationPath], this.env.FORENSIC_BACKUP_TIMEOUT_MS);
      } finally {
        await fs.rm(validationPath, { force: true });
      }

      return {
        encryptedPath,
        encryptedSha256: hash.digest('hex'),
        encryptedBytes: bytes,
        keyId: envelope.keyId,
        keyVersion: envelope.keyVersion,
        encryptedDataKey: envelope.encryptedDataKey,
        ivHex: iv.toString('hex'),
        authTagHex: authTag.toString('hex'),
      };
    } finally {
      envelope.plaintextDataKey.fill(0);
      await fs.rm(rawPath, { force: true });
    }
  }

  assertIsolatedTarget(targetUrl: string): void {
    const target = new URL(targetUrl);
    const allowedHosts = new Set(this.env.FORENSIC_RECOVERY_ALLOWED_HOSTS.split(',').map(x => x.trim()));
    const dbName = target.pathname.replace(/^\//, '');
    if (!allowedHosts.has(target.hostname)) throw new Error('Recovery host is not allowlisted');
    if (!dbName.startsWith(this.env.FORENSIC_RECOVERY_DATABASE_PREFIX)) {
      throw new Error('Recovery database name is not allowlisted');
    }
    if (targetUrl === this.env.FORENSIC_BACKUP_SOURCE_DATABASE_URL) {
      throw new Error('Production/source database restore is prohibited');
    }
  }

  async restoreEncrypted(input: {
    encryptedPath: string; archivePath: string; targetUrl: string; keyId: string; keyVersion: string;
    encryptedDataKey: string; ivHex: string; authTagHex: string; context: Readonly<Record<string,string>>;
  }): Promise<void> {
    this.assertIsolatedTarget(input.targetUrl);
    const key = await this.kms.decryptDataKey(input);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(input.authTagHex, 'hex'));
      await pipeline(createReadStream(input.encryptedPath), decipher, createWriteStream(input.archivePath, { mode: 0o600 }));
      await this.run(this.env.PG_RESTORE_PATH, ['--list', input.archivePath], this.env.FORENSIC_BACKUP_TIMEOUT_MS);
      await this.run(this.env.PG_RESTORE_PATH, [
        '--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', input.targetUrl, input.archivePath,
      ], this.env.FORENSIC_BACKUP_TIMEOUT_MS);
    } finally {
      key.fill(0);
      await fs.rm(input.archivePath, { force: true });
    }
  }
}
