// A software platform authenticator (what Face ID / Touch ID does on the phone), so passkey flows run end to end in tests.
// It creates a P-256 key, answers navigator.credentials.create() with "none" attestation and .get() with an ES256 assertion.
import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');

// Minimal CBOR encoder: unsigned/negative ints, byte strings, text strings, maps. Enough for attestation objects and COSE keys.
function cbor(v) {
  const head = (major, n) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n])
    : n < 65536 ? Buffer.from([major << 5 | 25, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(5); b[0] = major << 5 | 26; b.writeUInt32BE(n, 1); return b; })();
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported value');
}

export class SoftAuthenticator {
  constructor({ rpId, origin }) { this.rpId = rpId; this.origin = origin; this.credentials = new Map(); }
  rpIdHash() { return crypto.createHash('sha256').update(this.rpId).digest(); }
  clientData(type, challenge, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  }

  // navigator.credentials.create(): options are the server's PublicKeyCredentialCreationOptionsJSON.
  create(options, { origin } = {}) {
    if (options.rp?.id && options.rp.id !== this.rpId) throw new Error('rp id mismatch');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = crypto.randomBytes(32);
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const count = Buffer.alloc(4), len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
    const authData = Buffer.concat([this.rpIdHash(), Buffer.from([0x45]), count, Buffer.alloc(16), len, credId, cose]); // UP|UV|AT
    const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const id = b64u(credId);
    this.credentials.set(id, { privateKey, userHandle: options.user?.id, signCount: 0 });
    return { id, rawId: id, type: 'public-key',
      response: { attestationObject: b64u(attestationObject), clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, origin)),
                  transports: ['internal'], publicKeyAlgorithm: -7, publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })) },
      clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }

  // navigator.credentials.get(): picks the first allowed credential this authenticator holds.
  get(options, { origin, credentialId, tamper } = {}) {
    const allowed = (options.allowCredentials ?? []).map(c => c.id);
    const id = credentialId ?? [...this.credentials.keys()].find(k => !allowed.length || allowed.includes(k));
    const c = this.credentials.get(id);
    if (!c) throw new Error('no matching credential');
    c.signCount += 1;
    const count = Buffer.alloc(4); count.writeUInt32BE(c.signCount);
    const authData = Buffer.concat([this.rpIdHash(), Buffer.from([0x05]), count]); // UP|UV
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    let signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), c.privateKey);
    if (tamper === 'signature') signature = crypto.sign('sha256', Buffer.from('something else'), c.privateKey);
    return { id, rawId: id, type: 'public-key',
      response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(signature), userHandle: c.userHandle ?? null },
      clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }
}
