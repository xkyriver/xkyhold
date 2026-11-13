// Backup (docs/FORMAT.md, section 10.1): walk the chosen folders, store
// what the repository does not have yet, and write a snapshot last.

import type { DirHandleLike, FileHandleLike } from '../fs/handles'
import { CHUNK_SIZE } from './crypto'
import type { Repository, Snapshot, TreeEntry, TreeFile } from './repo'

/**
 * One top-level folder of the snapshot: either a folder the user chose
 * (`handle`), or a folder made in XkyHold that groups chosen folders and
 * files (`members`, with different names), which exists only in the backup.
 */
export interface BackupRoot {
  name: string
  handle?: DirHandleLike
  members?: (DirHandleLike | FileHandleLike)[]
  /** Sub-folders not to back up, as paths inside the root ("Downloads", "Work/Old"). */
  leaveOut?: string[]
}

export interface BackupProgress {
  files: number
  bytes: number
  skipped: number
  /** Files whose content was read (new or changed). */
  filesRead: number
  current: string
}

export interface BackupOptions {
  device: string
  /** The previous snapshot; unchanged files are taken from it unread. */
  parent?: Snapshot | null
  chunkSize?: number
  onProgress?: (progress: BackupProgress) => void
  signal?: AbortSignal
  now?: () => Date
}

/** A file or folder of the user's could not be read (locked, gone, denied). */
export class FileReadError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Could not read ${path}`, { cause })
    this.name = 'FileReadError'
  }
}

/** Runs a read of the user's own files, marking its failures as such. */
async function reading<T>(path: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    throw new FileReadError(path, err)
  }
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export async function backup(repo: Repository, roots: BackupRoot[], options: BackupOptions): Promise<Snapshot> {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE
  const { signal } = options
  const progress: BackupProgress = { files: 0, bytes: 0, skipped: 0, filesRead: 0, current: '' }
  // Bytes read so far of the file being stored: shown, so that a large file
  // does not look stuck, but only counted in the totals once it is done.
  let inFile = 0
  const report = () => options.onProgress?.({ ...progress, bytes: progress.bytes + inFile })

  async function previous(tree: string | undefined): Promise<Map<string, TreeEntry>> {
    const map = new Map<string, TreeEntry>()
    if (!tree) return map
    try {
      for (const entry of await repo.loadTree(tree)) map.set(entry.name, entry)
    } catch {
      // The old listing is unreadable: treat everything here as new.
    }
    return map
  }

  async function storeFile(handle: FileHandleLike, old: TreeEntry | undefined, path: string): Promise<TreeFile> {
    const file = await reading(path, () => handle.getFile())
    if (
      old?.type === 'file' &&
      old.size === file.size &&
      old.mtime === file.lastModified &&
      old.content.every((id) => repo.has(id))
    ) {
      return { ...old, name: handle.name }
    }
    progress.current = path
    progress.filesRead++
    report()
    const content: string[] = []
    let size = 0
    try {
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        signal?.throwIfAborted()
        const end = Math.min(offset + chunkSize, file.size)
        const chunk = new Uint8Array(await reading(path, () => file.slice(offset, end).arrayBuffer()))
        if (chunk.length === 0) break // the file shrank while being read
        content.push(await repo.saveBlob('data', chunk, signal))
        size += chunk.length
        inFile = size
        report()
      }
    } finally {
      inFile = 0
    }
    return { name: handle.name, type: 'file', size, mtime: file.lastModified, content }
  }

  async function storeDir(
    dir: DirHandleLike,
    oldTree: string | undefined,
    path: string,
    rel: string,
    leaveOut: Set<string>,
  ): Promise<string> {
    const old = await previous(oldTree)
    const children: (FileHandleLike | DirHandleLike)[] = []
    await reading(path, async () => {
      for await (const child of dir.values()) children.push(child)
    })
    children.sort(byName)

    const entries: TreeEntry[] = []
    for (const child of children) {
      signal?.throwIfAborted()
      const childPath = `${path}/${child.name}`
      const childRel = rel ? `${rel}/${child.name}` : child.name
      if (child.kind === 'directory' && leaveOut.has(childRel)) continue
      const before = old.get(child.name)
      try {
        if (child.kind === 'directory') {
          const subtree = await storeDir(
            child,
            before?.type === 'dir' ? before.subtree : undefined,
            childPath,
            childRel,
            leaveOut,
          )
          entries.push({ name: child.name, type: 'dir', subtree })
        } else {
          const entry = await storeFile(child, before, childPath)
          entries.push(entry)
          progress.files++
          progress.bytes += entry.size
        }
      } catch (err) {
        // Only failures reading the user's own files skip an entry. The
        // network, Drive or a bug must stop the backup, never thin it out.
        if (signal?.aborted || !(err instanceof FileReadError)) throw err
        progress.skipped++
      }
      report()
    }
    return repo.saveTree(entries, signal)
  }

  /**
   * A folder made in XkyHold: one entry per grouped folder or file. A
   * grouped folder is treated like a chosen folder, so failing to read one
   * stops the backup instead of quietly leaving it out. A grouped file is
   * treated like any other file: if it is gone or unreadable it is skipped
   * and counted.
   */
  async function storeGroup(
    members: (DirHandleLike | FileHandleLike)[],
    oldTree: string | undefined,
    path: string,
    leaveOut: Set<string>,
  ): Promise<string> {
    const old = await previous(oldTree)
    const entries: TreeEntry[] = []
    for (const member of [...members].sort(byName)) {
      signal?.throwIfAborted()
      const before = old.get(member.name)
      if (member.kind === 'file') {
        try {
          const entry = await storeFile(member, before, `${path}/${member.name}`)
          entries.push(entry)
          progress.files++
          progress.bytes += entry.size
        } catch (err) {
          if (signal?.aborted || !(err instanceof FileReadError)) throw err
          progress.skipped++
        }
        report()
        continue
      }
      const subtree = await storeDir(
        member,
        before?.type === 'dir' ? before.subtree : undefined,
        `${path}/${member.name}`,
        member.name,
        leaveOut,
      )
      entries.push({ name: member.name, type: 'dir', subtree })
    }
    return repo.saveTree(entries, signal)
  }

  try {
    const parentRoots = new Map((options.parent?.roots ?? []).map((r) => [r.name, r.tree]))
    const snapshotRoots: Snapshot['roots'] = []
    for (const root of roots) {
      const leaveOut = new Set(root.leaveOut ?? [])
      const parentTree = parentRoots.get(root.name)
      const tree = root.members
        ? await storeGroup(root.members, parentTree, root.name, leaveOut)
        : await storeDir(root.handle!, parentTree, root.name, '', leaveOut)
      snapshotRoots.push({ name: root.name, tree })
    }
    await repo.flush(signal)
    return await repo.saveSnapshot(
      {
        time: (options.now?.() ?? new Date()).toISOString(),
        device: options.device,
        roots: snapshotRoots,
        stats: { files: progress.files, bytes: progress.bytes, skipped: progress.skipped },
        parent: options.parent?.id ?? null,
      },
      signal,
    )
  } catch (err) {
    await repo.abandon()
    throw err
  }
}
