const DB_NAME = 'tcds-photo-recovery';
const STORE = 'captures';
const VERSION = 1;

export interface LocalCaptureRecord {
  id: string;
  sessionId: string;
  requirementId: string;
  createdAt: string;
  file: Blob;
  fileName: string;
  contentType: string;
  sha256: string;
  state: 'CAPTURED_LOCAL' | 'QUEUED_OFFLINE' | 'REMOTE_CONFIRMED';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sessionId', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalCapture(record: LocalCaptureRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listLocalCaptures(sessionId: string): Promise<LocalCaptureRecord[]> {
  const db = await openDb();
  const result = await new Promise<LocalCaptureRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('sessionId').getAll(sessionId);
    req.onsuccess = () => resolve(req.result as LocalCaptureRecord[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function removeLocalCapture(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
