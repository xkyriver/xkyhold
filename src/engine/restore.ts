// Restore (docs/FORMAT.md, section 10.2). Every chunk is verified against
// its id inside Repository.loadBlob before it reaches the target.

import type { Bytes } from './bytes'
import type { Repository, TreeEntry, TreeFile } from './repo'

/** Where restored files go: a real folder, a zip, or memory in tests. */
export interface RestoreTarget {
  createDir(name: string): Promise<RestoreTarget>
  writeFile(file: TreeFile, chunks: AsyncIterable<Bytes>): Promise<void>
}

export interface RestoreProgress {
  files: number
  bytes: number
  current: string
}

export interface RestoreOptions {
  onProgress?: (progress: RestoreProgress) => void
  signal?: AbortSignal
}

/** The verified content of a file, chunk by chunk. */
export async function* readFile(repo: Repository, file: TreeFile, signal?: AbortSignal): AsyncGenerator<Bytes> {
  for (const id of file.content) {
    signal?.throwIfAborted()
    yield await repo.loadBlob('data', id)
  }
}

/** Restores the given entries of one folder (all of them by default). */
export async function restoreEntries(
  repo: Repository,
  entries: TreeEntry[],
  target: RestoreTarget,
  options: RestoreOptions = {},
  progress: RestoreProgress = { files: 0, bytes: 0, current: '' },
  path = '',
): Promise<RestoreProgress> {
  for (const entry of entries) {
    options.signal?.throwIfAborted()
    const entryPath = path ? `${path}/${entry.name}` : entry.name
    if (entry.type === 'dir') {
      const sub = await target.createDir(entry.name)
      await restoreEntries(repo, await repo.loadTree(entry.subtree), sub, options, progress, entryPath)
    } else {
      progress.current = entryPath
      await target.writeFile(entry, readFile(repo, entry, options.signal))
      progress.files++
      progress.bytes += entry.size
      options.onProgress?.({ ...progress })
    }
  }
  return progress
}
