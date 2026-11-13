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
  /** Sub-folders not to back up, as paths inside this folder ("Downloads", "Work/Old"). */
  leaveOut?: string[]
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
 * Leaves the sub-folder at `path` out of backups, or puts it back. Leaving
 * a folder out also drops entries inside it, which it already covers.
 */
export async function setLeftOut(id: string, path: string, out: boolean): Promise<void> {
  const folder = (await listFolders()).find((f) => f.id === id)
  if (!folder) return
  folder.leaveOut = toggleLeftOut(folder.leaveOut ?? [], path, out)
  await withFolders('readwrite', (store) => store.put(folder))
}

/** The new list of left-out paths after leaving `path` out or putting it back. */
export function toggleLeftOut(list: string[], path: string, out: boolean): string[] {
  const kept = list.filter((p) => p !== path && !(out && p.startsWith(`${path}/`)))
  return out ? [...kept, path].sort() : kept
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
  return (await saveFolder(handle)).folder
}

/** Saves a folder the user chose, unless it is already in the list. */
async function saveFolder(handle: DirHandleLike): Promise<{ folder: SavedFolder; added: boolean }> {
  for (const existing of await listFolders()) {
    if (await existing.handle.isSameEntry?.(handle)) return { folder: existing, added: false }
  }
  const folder: SavedFolder = { id: crypto.randomUUID(), name: handle.name, handle }
  await withFolders('readwrite', (store) => store.put(folder))
  return { folder, added: true }
}

/** What came of dropping things on the folder list. */
export interface DropResult {
  /** Folders added to the list. */
  added: number
  /** Files: only folders are backed up. */
  files: number
  /** Items the browser would not hand over (for example the Documents folder itself). */
  refused: number
}

type Dropped = { kind: 'file' | 'directory' } | null

/** Sorts what the browser handed over for a drop: folders, files, and what it refused. */
export function sortDropped<T extends { kind: string }>(
  results: PromiseSettledResult<T | null>[],
): { dirs: T[]; files: number; refused: number } {
  const dirs: T[] = []
  let files = 0
  let refused = 0
  for (const r of results) {
    if (r.status === 'rejected' || !r.value) refused++
    else if (r.value.kind === 'directory') dirs.push(r.value)
    else files++
  }
  return { dirs, files, refused }
}

/**
 * Adds every folder dropped on the page, from a file manager. Must be called
 * inside the drop event: the browser only hands the items over then.
 */
export async function addDropped(items: DataTransferItemList): Promise<DropResult> {
  // Ask for every handle before awaiting anything: the list empties as
  // soon as the drop event is over.
  const pending: Promise<Dropped>[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const get = (item as unknown as { getAsFileSystemHandle?(): Promise<Dropped> }).getAsFileSystemHandle
    pending.push(get ? get.call(item) : Promise.resolve(null))
  }
  const { dirs, files, refused } = sortDropped(await Promise.allSettled(pending))
  let added = 0
  for (const dir of dirs) if ((await saveFolder(dir as unknown as DirHandleLike)).added) added++
  return { added, files, refused }
}

/** Whether this browser can hand over dropped folders. */
export const canDropFolders = (): boolean =>
  typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype

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

/**
 * Asks the user where restored files should go. Returns null if they
 * cancel. Must be called from a user gesture.
 */
export async function pickRestoreFolder(): Promise<unknown | null> {
  const picker = (window as unknown as { showDirectoryPicker(options?: object): Promise<unknown> }).showDirectoryPicker
  try {
    return await picker.call(window, { mode: 'readwrite' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}
