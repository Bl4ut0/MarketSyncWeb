import type { FlavorId, NormalizedSnapshot, WowheadTooltipMeta } from '@marketsync/shared';

const DB_NAME = 'marketsync_web_cache_v1';
const DB_VERSION = 3;
const STORE_NAME = 'snapshots';
const TOOLTIP_STORE_NAME = 'wowhead_tooltips';
const MAX_MEMORY_ENTRIES = 6;
const MAX_IDB_ENTRIES = 12;

interface StoredRecord {
  path: string;
  cachedAt: number;
  snapshot: NormalizedSnapshot;
}

interface StoredTooltipRecord {
  flavor: FlavorId;
  itemId: number;
  cachedAt: number;
  meta: WowheadTooltipMeta;
}

const memoryLru = new Map<string, NormalizedSnapshot>();

function touchMemoryLru(path: string, snapshot: NormalizedSnapshot): void {
  if (memoryLru.has(path)) {
    memoryLru.delete(path);
  }
  memoryLru.set(path, snapshot);
  while (memoryLru.size > MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryLru.keys().next().value;
    if (oldestKey === undefined) break;
    memoryLru.delete(oldestKey);
  }
}

function openSnapshotDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) {
        resolve(null);
        return;
      }
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'path' });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
        if (event.oldVersion < 3) {
          if (db.objectStoreNames.contains(TOOLTIP_STORE_NAME)) {
            db.deleteObjectStore(TOOLTIP_STORE_NAME);
          }
          db.createObjectStore(TOOLTIP_STORE_NAME, { keyPath: ['flavor', 'itemId'] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedSnapshot(
  path: string,
): Promise<NormalizedSnapshot | null> {
  const memHit = memoryLru.get(path);
  if (memHit) {
    touchMemoryLru(path, memHit);
    return memHit;
  }

  const db = await openSnapshotDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(path);
      req.onsuccess = () => {
        const rec = req.result as StoredRecord | undefined;
        db.close();
        if (rec && rec.snapshot) {
          touchMemoryLru(path, rec.snapshot);
          resolve(rec.snapshot);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function putCachedSnapshot(
  path: string,
  snapshot: NormalizedSnapshot,
): Promise<void> {
  touchMemoryLru(path, snapshot);

  const db = await openSnapshotDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredRecord = {
        path,
        cachedAt: Date.now(),
        snapshot,
      };
      store.put(record);

      // Prune oldest records if store grows beyond MAX_IDB_ENTRIES
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_IDB_ENTRIES) {
          const idx = store.index('cachedAt');
          const excess = countReq.result - MAX_IDB_ENTRIES;
          let removed = 0;
          const cursorReq = idx.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && removed < excess) {
              cursor.delete();
              removed += 1;
              cursor.continue();
            }
          };
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function clearSnapshotCache(): Promise<void> {
  memoryLru.clear();
  const db = await openSnapshotDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadAllCachedTooltips(): Promise<
  StoredTooltipRecord[]
> {
  const db = await openSnapshotDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(TOOLTIP_STORE_NAME, 'readonly');
      const store = tx.objectStore(TOOLTIP_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result as StoredTooltipRecord[] | undefined) ?? [];
        db.close();
        resolve(records);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function putCachedTooltips(
  flavor: FlavorId,
  entries: Array<{ itemId: number; meta: WowheadTooltipMeta }>,
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openSnapshotDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TOOLTIP_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TOOLTIP_STORE_NAME);
      const now = Date.now();
      for (const entry of entries) {
        store.put({
          flavor,
          itemId: entry.itemId,
          cachedAt: now,
          meta: entry.meta,
        } satisfies StoredTooltipRecord);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
