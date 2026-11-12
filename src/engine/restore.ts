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

/** How many chunks of one file are fetched ahead of the writer. */
const CHUNK_WINDOW = 3
/** How many files are restored at the same time. */
const FILE_CONCURRENCY = 4

/** The verified content of a file, chunk by chunk, fetched a few ahead. */
export async function* readFile(repo: Repository, file: TreeFile, signal?: AbortSignal): AsyncGenerator<Bytes> {
  const ahead: Promise<Bytes>[] = []
  let next = 0
  while (next < file.content.length || ahead.length > 0) {
    signal?.throwIfAborted()
    while (ahead.length < CHUNK_WINDOW && next < file.content.length) {
      const chunk = repo.loadBlob('data', file.content[next++])
      chunk.catch(() => {}) // reported when it is awaited below
      ahead.push(chunk)
    }
    yield await ahead.shift()!
  }
}

/** Restores the given entries of one folder (all of them by default). */
export async function restoreEntries(
  repo: Repository,
  entries: TreeEntry[],
  target: RestoreTarget,
  options: RestoreOptions = {},
  progress: RestoreProgress = { files: 0, bytes: 0, current: '' },
): Promise<RestoreProgress> {
  const running = new Set<Promise<void>>()
  let failure: { error: unknown } | null = null
  // Bytes written so far of the files in progress: shown, so that a large
  // file does not look stuck, but only counted in the totals once done.
  let partial = 0
  const report = () => options.onProgress?.({ ...progress, bytes: progress.bytes + partial })

  async function file(entry: TreeFile, into: RestoreTarget, path: string): Promise<void> {
    while (running.size >= FILE_CONCURRENCY) await Promise.race(running)
    if (failure) return
    const job = (async () => {
      progress.current = path
      let mine = 0
      const counted = async function* (chunks: AsyncIterable<Bytes>) {
        for await (const chunk of chunks) {
          yield chunk
          mine += chunk.length
          partial += chunk.length
          report()
        }
      }
      try {
        await into.writeFile(entry, counted(readFile(repo, entry, options.signal)))
      } finally {
        partial -= mine
      }
      progress.files++
      progress.bytes += entry.size
      report()
    })()
      .catch((error) => void (failure ??= { error }))
      .finally(() => running.delete(job))
    running.add(job)
  }

  async function walk(list: TreeEntry[], into: RestoreTarget, path: string): Promise<void> {
    for (const entry of list) {
      if (failure) return
      options.signal?.throwIfAborted()
      const entryPath = path ? `${path}/${entry.name}` : entry.name
      if (entry.type === 'dir') {
        await walk(await repo.loadTree(entry.subtree), await into.createDir(entry.name), entryPath)
      } else {
        await file(entry, into, entryPath)
      }
    }
  }

  try {
    await walk(entries, target, '')
  } catch (error) {
    failure ??= { error }
  }
  while (running.size > 0) await Promise.all(running)
  if (failure) throw (failure as { error: unknown }).error
  return progress
}
