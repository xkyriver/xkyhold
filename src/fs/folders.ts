// The folders the user chose to back up. Directory handles are stored in
// IndexedDB (they are structured-cloneable), so the choice survives a
// restart; the *permission* to read them may not, and is re-checked on
// every load.

import type { DirHandleLike, PermissionState } from './handles'

const DB_NAME = 'xkyhold'
const STORE = 'folders'

export interface SavedFolder {
  id: string
  name: string
  handle: DirHandleLike
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export function listFolders(): Promise<SavedFolder[]> {
  return withStore('readonly', (store) => store.getAll() as IDBRequest<SavedFolder[]>)
}

export async function removeFolder(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

/**
 * Opens the browser's folder picker and saves the choice. Returns null if
 * the user cancelled, and the existing entry if the folder was already
 * added. Must be called from a user gesture.
 */
export async function addFolder(): Promise<SavedFolder | null> {
  const picker = (window as unknown as { showDirectoryPicker(options?: object): Promise<DirHandleLike> })
    .showDirectoryPicker
  let handle: DirHandleLike
  try {
    handle = await picker.call(window, { mode: 'read' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
  for (const existing of await listFolders()) {
    if (await existing.handle.isSameEntry?.(handle)) return existing
  }
  const folder: SavedFolder = { id: crypto.randomUUID(), name: handle.name, handle }
  await withStore('readwrite', (store) => store.put(folder))
  return folder
}

/** Current read permission, without prompting. */
export async function checkPermission(folder: SavedFolder): Promise<PermissionState> {
  try {
    return (await folder.handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
  } catch {
    return 'denied' // e.g. the folder was deleted or moved
  }
}

/** Asks the user to allow reading again. Must be called from a user gesture. */
export async function requestPermission(folder: SavedFolder): Promise<PermissionState> {
  try {
    return (await folder.handle.requestPermission?.({ mode: 'read' })) ?? 'granted'
  } catch {
    return 'denied'
  }
}
