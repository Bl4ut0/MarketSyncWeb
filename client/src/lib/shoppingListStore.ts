import type { ShoppingList, ShoppingListItem } from '@marketsync/shared';

const STORAGE_KEY = 'marketsync_shopping_lists_v1';
const ACTIVE_LIST_KEY = 'marketsync_active_shopping_list_v1';
const IDB_NAME = 'marketsync_lists_v1';
const IDB_STORE = 'lists';

export interface StoredShoppingList {
  id: string;
  list: ShoppingList;
  updatedAt: string;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `list_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultList(name = 'My Shopping List'): StoredShoppingList {
  return {
    id: makeId(),
    list: {
      v: 1,
      n: name.slice(0, 64) || 'My Shopping List',
      i: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

function mirrorToIndexedDb(lists: StoredShoppingList[]): void {
  try {
    const idb = globalThis.indexedDB;
    if (!idb) return;
    const req = idb.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      try {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.clear();
        for (const item of lists) {
          store.put(item);
        }
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch {
        // Ignore IDB mirror failures
      }
    };
  } catch {
    // Ignore IDB unavailable
  }
}

export function loadShoppingLists(): StoredShoppingList[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as StoredShoppingList[];
      }
    }
  } catch {
    // Fall through to default
  }
  const initial = [createDefaultList('My Shopping List')];
  saveShoppingLists(initial);
  return initial;
}

export function saveShoppingLists(lists: StoredShoppingList[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {
    // Ignore storage quota errors
  }
  mirrorToIndexedDb(lists);
}

export function loadActiveListId(lists: StoredShoppingList[]): string {
  try {
    const saved = globalThis.localStorage?.getItem(ACTIVE_LIST_KEY);
    if (saved && lists.some((l) => l.id === saved)) {
      return saved;
    }
  } catch {
    // Ignore
  }
  return lists[0]?.id ?? '';
}

export function saveActiveListId(id: string): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_LIST_KEY, id);
  } catch {
    // Ignore
  }
}

export function upsertItemInList(
  list: ShoppingList,
  newItem: ShoppingListItem,
): ShoppingList {
  const idx = list.i.findIndex(
    (item) => item.id === newItem.id && (item.s ?? 0) === (newItem.s ?? 0),
  );
  if (idx >= 0) {
    const nextItems = [...list.i];
    const existing = nextItems[idx]!;
    nextItems[idx] = {
      ...existing,
      ...newItem,
      q: existing.q + newItem.q,
    };
    return { ...list, i: nextItems };
  }
  return { ...list, i: [...list.i, newItem] };
}
