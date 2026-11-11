// The app's local database (IndexedDB): the chosen folders and a small
// key-value store for settings. Nothing here leaves the browser.

const DB_NAME = 'xkyhold'
const DB_VERSION = 2

export type StoreName = 'folders' | 'settings'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode)
      const request = run(tx.objectStore(name))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const settings = {
  get: <T>(key: string) => withStore('settings', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: async (key: string, value: unknown) => void (await withStore('settings', 'readwrite', (s) => s.put(value, key))),
  delete: async (key: string) => void (await withStore('settings', 'readwrite', (s) => s.delete(key))),
}

export const clearStore = async (name: StoreName) => void (await withStore(name, 'readwrite', (s) => s.clear()))
