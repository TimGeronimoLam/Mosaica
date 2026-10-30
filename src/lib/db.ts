import type { MosaicRecord } from '../types';

const DB_NAME = 'mosaica';
const STORE = 'mosaics';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the mosaic database.'));
  });
  return dbPromise;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Database request failed.'));
  });
}

export async function listMosaics(): Promise<MosaicRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const all = await request(tx.objectStore(STORE).getAll() as IDBRequest<MosaicRecord[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMosaic(id: string): Promise<MosaicRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return request(tx.objectStore(STORE).get(id) as IDBRequest<MosaicRecord | undefined>);
}

export async function putMosaic(rec: MosaicRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await request(tx.objectStore(STORE).put(rec));
}

export async function deleteMosaic(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await request(tx.objectStore(STORE).delete(id));
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
