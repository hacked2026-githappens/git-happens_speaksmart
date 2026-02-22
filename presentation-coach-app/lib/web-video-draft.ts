const DB_NAME = 'speaksmart-web-cache';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'coach-video-draft';

type DraftRecord = {
  blob: Blob;
  fileName: string;
  durationSeconds: number | null;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void, fail: (err: unknown) => void) => void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    run(store, resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveWebVideoDraft(
  blob: Blob,
  fileName: string,
  durationSeconds: number | null,
): Promise<void> {
  const payload: DraftRecord = {
    blob,
    fileName,
    durationSeconds,
    savedAt: Date.now(),
  };

  await withStore<void>('readwrite', (store, done, fail) => {
    const req = store.put(payload, DRAFT_KEY);
    req.onsuccess = () => done(undefined);
    req.onerror = () => fail(req.error);
  });
}

export async function loadWebVideoDraft(): Promise<DraftRecord | null> {
  return withStore<DraftRecord | null>('readonly', (store, done, fail) => {
    const req = store.get(DRAFT_KEY);
    req.onsuccess = () => done((req.result as DraftRecord | undefined) ?? null);
    req.onerror = () => fail(req.error);
  });
}

export async function clearWebVideoDraft(): Promise<void> {
  await withStore<void>('readwrite', (store, done, fail) => {
    const req = store.delete(DRAFT_KEY);
    req.onsuccess = () => done(undefined);
    req.onerror = () => fail(req.error);
  });
}
