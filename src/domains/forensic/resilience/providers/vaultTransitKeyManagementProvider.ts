import { readFile } from 'node:fs/promises';
import type { DataKeyEnvelope, KeyManagementProvider } from './keyManagementProvider';

/**
 * Domain 7I.1 — production KeyManagementProvider backed by HashiCorp Vault's
 * Transit secrets engine (envelope encryption).
 *
 * generateDataKey  -> POST {mount}/datakey/plaintext/{key}
 * decryptDataKey   -> POST {mount}/decrypt/{key}
 *
 * Auth: a Vault token is read fresh on every call from the Vault Agent sink file
 * (APP_VAULT_TOKEN_FILE) so Agent-driven rotation is picked up transparently.
 */
export interface VaultTransitConfig {
  readonly address: string;
  readonly transitMount: string;
  readonly keyName: string;
  readonly getToken: () => Promise<string>;
  readonly namespace?: string;
  readonly requestTimeoutMs?: number;
  /** Only enable if the Transit KEK was created with derived=true (bootstrap 03 creates it non-derived). */
  readonly deriveContext?: boolean;
}

const DEK_BYTES = 32;

export function encodeTransitContext(context: Readonly<Record<string, string>>): string {
  const entries = Object.keys(context).sort().map(k => [k, context[k]] as const);
  return Buffer.from(JSON.stringify(entries), 'utf8').toString('base64');
}

export class VaultTransitKeyManagementProvider implements KeyManagementProvider {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: VaultTransitConfig) {
    if (!/^https:\/\//.test(config.address)) {
      throw new Error('VaultTransit: address must be an https:// URL');
    }
    this.base = `${config.address.replace(/\/+$/, '')}/v1/${config.transitMount.replace(/^\/+|\/+$/g, '')}`;
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
  }

  async generateDataKey(context: Readonly<Record<string, string>>): Promise<DataKeyEnvelope> {
    const payload: Record<string, unknown> = { bits: 256 };
    if (this.config.deriveContext) payload.context = encodeTransitContext(context);
    const body = await this.call(`/datakey/plaintext/${encodeURIComponent(this.config.keyName)}`, payload);
    const plaintextB64 = String(body?.data?.plaintext ?? '');
    const ciphertext = String(body?.data?.ciphertext ?? '');
    const keyVersion = body?.data?.key_version;
    const plaintextDataKey = Buffer.from(plaintextB64, 'base64');
    if (plaintextDataKey.length !== DEK_BYTES) {
      plaintextDataKey.fill(0);
      throw new Error(`VaultTransit: expected ${DEK_BYTES}-byte data key, got ${plaintextDataKey.length}`);
    }
    if (!ciphertext.startsWith('vault:')) {
      plaintextDataKey.fill(0);
      throw new Error('VaultTransit: missing/invalid wrapped data key');
    }
    return { keyId: this.config.keyName, keyVersion: String(keyVersion ?? ''), plaintextDataKey, encryptedDataKey: ciphertext };
  }

  async decryptDataKey(input: {
    keyId: string; keyVersion: string; encryptedDataKey: string; context: Readonly<Record<string, string>>;
  }): Promise<Buffer> {
    if (input.keyId !== this.config.keyName) {
      throw new Error(`VaultTransit: keyId "${input.keyId}" does not match configured key "${this.config.keyName}"`);
    }
    const payload: Record<string, unknown> = { ciphertext: input.encryptedDataKey };
    if (this.config.deriveContext) payload.context = encodeTransitContext(input.context);
    const body = await this.call(`/decrypt/${encodeURIComponent(this.config.keyName)}`, payload);
    const plaintext = Buffer.from(String(body?.data?.plaintext ?? ''), 'base64');
    if (plaintext.length !== DEK_BYTES) {
      plaintext.fill(0);
      throw new Error(`VaultTransit: unwrapped data key has wrong length ${plaintext.length}`);
    }
    return plaintext;
  }

  private async call(path: string, payload: Record<string, unknown>): Promise<any> {
    const token = await this.config.getToken();
    if (!token) throw new Error('VaultTransit: empty Vault token');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      const headers: Record<string, string> = {
        'X-Vault-Token': token, 'X-Vault-Request': 'true', 'content-type': 'application/json',
      };
      if (this.config.namespace) headers['X-Vault-Namespace'] = this.config.namespace;
      res = await fetch(`${this.base}${path}`, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (err) {
      throw new Error(`VaultTransit: request to ${path} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { detail = (JSON.parse(text).errors ?? []).join('; ') || text; } catch { /* keep raw */ }
      throw new Error(`VaultTransit: ${path} -> HTTP ${res.status}: ${detail}`);
    }
    return text ? JSON.parse(text) : {};
  }
}

export function createVaultTransitKeyManagementProvider(
  env: NodeJS.ProcessEnv = process.env,
): VaultTransitKeyManagementProvider {
  const address = reqEnv(env, 'VAULT_ADDR');
  const keyName = env.FORENSIC_KMS_KEY_NAME ?? env.VAULT_BACKUP_KEY;
  if (!keyName) throw new Error('VaultTransit: set FORENSIC_KMS_KEY_NAME (or VAULT_BACKUP_KEY)');
  const tokenFile = env.APP_VAULT_TOKEN_FILE;
  const staticToken = env.VAULT_TOKEN;
  if (!tokenFile && !staticToken) {
    throw new Error('VaultTransit: set APP_VAULT_TOKEN_FILE (Vault Agent sink) or VAULT_TOKEN');
  }
  return new VaultTransitKeyManagementProvider({
    address,
    transitMount: env.VAULT_TRANSIT_MOUNT ?? 'transit',
    keyName,
    namespace: env.VAULT_NAMESPACE,
    deriveContext: env.FORENSIC_KMS_DERIVED === 'true',
    getToken: async () => {
      if (tokenFile) return (await readFile(tokenFile, 'utf8')).trim();
      return staticToken as string;
    },
  });
}

function reqEnv(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`VaultTransit: missing required env ${name}`);
  return v;
}
