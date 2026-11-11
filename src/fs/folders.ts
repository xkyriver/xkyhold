// The folders the user chose to back up. Directory handles are stored in
// IndexedDB (they are structured-cloneable), so the choice survives a
// restart; the *permission* to read them may not, and is re-checked on
// every load.

import { withStore } from '../state/db'
import type { DirHandleLike, PermissionState } from './handles'

export interface SavedFolder {
  id: string
  name: string
  handle: DirHandleLike
}

const withFolders = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) =>
  withStore('folders', mode, run)

export function listFolders(): Promise<SavedFolder[]> {
  return withFolders('readonly', (store) => store.getAll() as IDBRequest<SavedFolder[]>)
}

export async function removeFolder(id: string): Promise<void> {
  await withFolders('readwrite', (store) => store.delete(id))
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
  await withFolders('readwrite', (store) => store.put(folder))
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
