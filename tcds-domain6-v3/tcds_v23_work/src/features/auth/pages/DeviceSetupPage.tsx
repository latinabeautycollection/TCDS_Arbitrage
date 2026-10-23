// TCDS device setup (Login V2). The vendor PWA expects a device key and profile to exist already, and 6.1B has no
// enrollment route, so a phone could never be set up. This page:
//   1. creates an ES256 key pair on this device (the private key is non-extractable: it can sign here, never leave);
//   2. shows the public key, which an administrator registers on the server;
//   3. saves the device id / credential id the server returned, completing the device profile used at login.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { deviceCredentialStore } from '../storage/deviceCredentialStore';
import type { DeviceEnrollmentProfile } from '../types/authTypes';

const DB_NAME = 'tcds-warehouse-identity', SECRET_STORE = 'device-secrets', PENDING = 'pending-setup-key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('device-profile')) db.createObjectStore('device-profile');
      if (!db.objectStoreNames.contains(SECRET_STORE)) db.createObjectStore(SECRET_STORE);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(SECRET_STORE, mode), r = fn(tx.objectStore(SECRET_STORE));
      r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    };
  });
}
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export function DeviceSetupPage() {
  const [existing, setExisting] = useState<DeviceEnrollmentProfile | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [form, setForm] = useState({ deviceId: '', credentialId: '', facilityId: '', stationId: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    deviceCredentialStore.profile().then(setExisting).catch(() => setExisting(null));
    idb<{ publicKey: string } | undefined>('readonly', s => s.get(PENDING)).then(p => { if (p) setPublicKey(p.publicKey); }).catch(() => {});
  }, []);

  async function createKey() {
    setBusy(true); setMessage(null);
    try {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const spki = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
      await idb('readwrite', s => s.put({ privateKey: pair.privateKey, publicKey: spki }, PENDING));
      setPublicKey(spki);
    } catch (e) { setMessage(`This browser could not create a device key: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function save(ev: FormEvent) {
    ev.preventDefault(); setMessage(null);
    const v = { deviceId: form.deviceId.trim(), credentialId: form.credentialId.trim(), facilityId: form.facilityId.trim(), stationId: form.stationId.trim() };
    if (![v.deviceId, v.credentialId, v.facilityId].every(x => UUID.test(x)) || (v.stationId && !UUID.test(v.stationId))) {
      setMessage('Each id must be the value printed by the registration command.'); return;
    }
    setBusy(true);
    try {
      const pending = await idb<{ privateKey: CryptoKey; publicKey: string } | undefined>('readonly', s => s.get(PENDING));
      if (!pending) throw new Error('No device key on this phone. Create one first.');
      const profile: DeviceEnrollmentProfile = { schemaVersion: 1, deviceId: v.deviceId, credentialId: v.credentialId, facilityId: v.facilityId,
        stationId: v.stationId || null, algorithm: 'ES256', enrolledAt: new Date().toISOString() };
      const assertion = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      await deviceCredentialStore.provision(profile, { schemaVersion: 1, deviceAssertion: assertion, signingKey: pending.privateKey });
      await idb('readwrite', s => s.delete(PENDING));
      setExisting(profile); setPublicKey(null);
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!window.confirm('Remove this device key and profile? The device must be registered again.')) return;
    await deviceCredentialStore.clear(); await idb('readwrite', s => s.delete(PENDING)).catch(() => {});
    setExisting(null); setPublicKey(null);
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 p-5">
      <h1 className="text-2xl font-semibold">Set up this device</h1>
      {existing ? (
        <section className="space-y-3 rounded-xl border p-4">
          <p>This device is set up and can be used to sign in.</p>
          <p className="break-all text-sm text-gray-500">Device {existing.deviceId}</p>
          <div className="flex gap-3">
            <Link className="rounded-lg bg-black px-4 py-2 text-white" to="/">Go to sign in</Link>
            <button className="rounded-lg border px-4 py-2" onClick={reset}>Reset device</button>
          </div>
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-semibold">1. Create this device's key</h2>
            <p className="text-sm text-gray-600">The private key is created on this phone and can never leave it.</p>
            {!publicKey && <button disabled={busy} className="rounded-lg bg-black px-4 py-2 text-white" onClick={createKey}>Create device key</button>}
            {publicKey && (
              <>
                <p className="text-sm">Send this public key to your administrator to register the device:</p>
                <textarea readOnly className="h-28 w-full rounded border p-2 font-mono text-xs" value={publicKey} onFocus={e => e.currentTarget.select()} />
                <button className="rounded-lg border px-4 py-2" onClick={() => navigator.clipboard?.writeText(publicKey)}>Copy public key</button>
              </>
            )}
          </section>
          {publicKey && (
            <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
              <h2 className="font-semibold">2. Enter the details from registration</h2>
              {(['deviceId', 'credentialId', 'facilityId', 'stationId'] as const).map(k => (
                <label key={k} className="block text-sm">
                  {k === 'stationId' ? 'Station id (optional)' : k.replace(/Id$/, ' id').replace(/^./, c => c.toUpperCase())}
                  <input className="mt-1 w-full rounded border p-2 font-mono text-xs" value={form[k]} autoCapitalize="none" autoCorrect="off"
                         onChange={e => setForm({ ...form, [k]: e.target.value })} />
                </label>
              ))}
              <button disabled={busy} className="rounded-lg bg-black px-4 py-2 text-white" type="submit">Save device</button>
            </form>
          )}
        </>
      )}
      {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
    </main>
  );
}
