import type { OfflinePutAwayOperation } from '../types/storageTypes';

const DB_NAME = 'tcds-warehouse-putaway';
const STORE = 'operations';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'operationId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open put-away recovery queue.'));
  });
}

export async function queueOfflineOperation(operation: OfflinePutAwayOperation): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(operation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save offline put-away work.'));
  });
  db.close();
}

export async function listOfflineOperations(sessionId?: string): Promise<OfflinePutAwayOperation[]> {
  const db = await openDb();
  const values = await new Promise<OfflinePutAwayOperation[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as OfflinePutAwayOperation[]);
    request.onerror = () => reject(request.error ?? new Error('Unable to read offline put-away work.'));
  });
  db.close();
  return values.filter((value) => !sessionId || value.sessionId === sessionId);
}

export async function removeOfflineOperation(operationId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(operationId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to remove synced put-away work.'));
  });
  db.close();
}
