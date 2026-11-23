// Software passkey (ES256) for STAGING tests only: produces WebAuthn assertions the same shape a browser returns
// (AuthenticationResponseJSON). Keys live only in the test process / a 0600 file; never used outside staging fixtures.
'use strict';
const crypto = require('node:crypto');
const b64u = b => Buffer.from(b).toString('base64url');

function cborBytes(buf) { return Buffer.concat([Buffer.from([0x58, buf.length]), buf]); }   // byte string, 24..255 bytes

function create() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  // COSE_Key {1:2 (EC2), 3:-7 (ES256), -1:1 (P-256), -2:x, -3:y}
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), cborBytes(x), Buffer.from([0x22]), cborBytes(y)]);
  return { credentialId: b64u(crypto.randomBytes(16)), cosePublicKey: cose, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}

function assert(k, { rpId, origin, challenge, counter = 1, userVerified = true, userHandle = null }) {
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
  const cnt = Buffer.alloc(4); cnt.writeUInt32BE(counter);
  const authData = Buffer.concat([rpIdHash, Buffer.from([userVerified ? 0x05 : 0x01]), cnt]);
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]);
  const signature = crypto.sign('sha256', signed, crypto.createPrivateKey(k.privateKeyPem));   // DER, as authenticators return
  return { id: k.credentialId, rawId: k.credentialId, type: 'public-key',
    response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(signature), userHandle },
    clientExtensionResults: {}, authenticatorAttachment: 'platform' };
}
module.exports = { create, assert };
