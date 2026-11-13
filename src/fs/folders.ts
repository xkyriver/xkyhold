// The folders the user chose to back up. Directory handles are stored in
// IndexedDB (they are structured-cloneable), so the choice survives a
// restart; the *permission* to read them may not, and is re-checked on
// every load.

import { withStore } from '../state/db'
import type { DirHandleLike, FileHandleLike, PermissionState } from './handles'

/**
 * A folder the user chose, or a single file they put inside a folder made
 * in XkyHold (`handle.kind` says which). Files only live inside such a
 * folder: the backup's top level holds folders.
 */
export interface SavedFolder {
  id: string
  name: string
  handle: DirHandleLike | FileHandleLike
  /** Sub-folders not to back up, as paths inside this folder ("Downloads", "Work/Old"). */
  leaveOut?: string[]
  /**
   * The folder made in XkyHold that holds this one in the backup, if any
   * ("Documents"). It exists only in the backup.
   */
  group?: string
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
export async function addFolder(group?: string): Promise<AddResult | null> {
  const picker = (window as unknown as { showDirectoryPicker(options?: object): Promise<DirHandleLike> })
    .showDirectoryPicker
  let handle: DirHandleLike
  try {
    handle = await picker.call(window, { mode: 'read' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
  return saveFolder(handle, group)
}

/** What happened to one folder the user chose. */
export type AddResult = 'added' | 'already' | 'clash'

/**
 * Where a folder called `name` would clash in the backup: inside `group`,
 * with another grouped folder of that name; at the top, with a folder or a
 * group of that name. Two folders there cannot share a name.
 */
export function clashes(folders: Pick<SavedFolder, 'name' | 'group'>[], name: string, group?: string): boolean {
  if (group) return folders.some((f) => f.group === group && f.name === name)
  return folders.some((f) => (!f.group && f.name === name) || f.group === name)
}

/** Removes every folder held by `group`, and so the group itself. */
export async function removeGroup(group: string): Promise<void> {
  for (const folder of await listFolders()) if (folder.group === group) await removeFolder(folder.id)
}

/**
 * Opens the browser's file picker, where several files can be chosen at
 * once, and puts them inside `group`. Returns null if the user cancelled.
 * Must be called from a user gesture.
 */
export async function addFiles(group: string): Promise<DropResult | null> {
  const picker = (window as unknown as { showOpenFilePicker(options?: object): Promise<FileHandleLike[]> })
    .showOpenFilePicker
  let handles: FileHandleLike[]
  try {
    handles = await picker.call(window, { multiple: true })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
  return saveAll(handles, group, 0)
}

/** Whether this browser can pick several files at once. */
export const canPickFiles = (): boolean => typeof window !== 'undefined' && 'showOpenFilePicker' in window

/** Saves a folder or file the user chose, unless it is already in the list or its name is taken. */
async function saveFolder(handle: DirHandleLike | FileHandleLike, group?: string): Promise<AddResult> {
  const folders = await listFolders()
  for (const existing of folders) {
    if (await existing.handle.isSameEntry?.(handle)) return 'already'
  }
  if (clashes(folders, handle.name, group)) return 'clash'
  const folder: SavedFolder = { id: crypto.randomUUID(), name: handle.name, handle, ...(group ? { group } : {}) }
  await withFolders('readwrite', (store) => store.put(folder))
  return 'added'
}

/** What came of dropping or picking several things at once. */
export interface DropResult {
  /** Folders and files added to the list. */
  added: number
  /** Files dropped where only folders can go (outside a folder made in XkyHold). */
  files: number
  /** Items the browser would not hand over (for example the Documents folder itself). */
  refused: number
  /** Items not added because one with the same name is already there. */
  clashed: number
}

type Dropped = { kind: 'file' | 'directory' } | null

/** Sorts what the browser handed over for a drop: folders, files, and what it refused. */
export function sortDropped<T extends { kind: string }>(
  results: PromiseSettledResult<T | null>[],
): { dirs: T[]; files: T[]; refused: number } {
  const dirs: T[] = []
  const files: T[] = []
  let refused = 0
  for (const r of results) {
    if (r.status === 'rejected' || !r.value) refused++
    else if (r.value.kind === 'directory') dirs.push(r.value)
    else files.push(r.value)
  }
  return { dirs, files, refused }
}

async function saveAll(
  handles: (DirHandleLike | FileHandleLike)[],
  group: string | undefined,
  refused: number,
): Promise<DropResult> {
  let added = 0
  let clashed = 0
  for (const handle of handles) {
    const result = await saveFolder(handle, group)
    if (result === 'added') added++
    else if (result === 'clash') clashed++
  }
  return { added, files: 0, refused, clashed }
}

/**
 * Adds everything dropped on the page from a file manager: folders, and
 * files too when dropped inside a folder made in XkyHold (`group`). Must
 * be called inside the drop event: the browser only hands the items over
 * then.
 */
export async function addDropped(items: DataTransferItemList, group?: string): Promise<DropResult> {
  // Ask for every handle before awaiting anything: the list empties as
  // soon as the drop event is over.
  const pending: Promise<Dropped>[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const get = (item as unknown as { getAsFileSystemHandle?(): Promise<Dropped> }).getAsFileSystemHandle
    pending.push(get ? get.call(item) : Promise.resolve(null))
  }
  const { dirs, files, refused } = sortDropped(await Promise.allSettled(pending))
  const accepted = (group ? [...dirs, ...files] : dirs) as unknown as (DirHandleLike | FileHandleLike)[]
  const result = await saveAll(accepted, group, refused)
  return { ...result, files: group ? 0 : files.length }
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
