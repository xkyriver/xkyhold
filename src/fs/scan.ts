import type { DirHandleLike } from './handles'

export interface ScanResult {
  files: number
  bytes: number
  /** Entries that could not be read (locked, vanished, permission). */
  skipped: number
}

export interface ScanOptions {
  onProgress?: (soFar: ScanResult) => void
  signal?: AbortSignal
}

/**
 * Walks a folder and totals its files. Unreadable entries are counted as
 * skipped rather than failing the walk — one locked file must not stop a
 * backup.
 */
export async function scanFolder(root: DirHandleLike, options: ScanOptions = {}): Promise<ScanResult> {
  const result: ScanResult = { files: 0, bytes: 0, skipped: 0 }
  const pending: DirHandleLike[] = [root]

  while (pending.length > 0) {
    const dir = pending.pop()!
    try {
      for await (const entry of dir.values()) {
        options.signal?.throwIfAborted()
        if (entry.kind === 'directory') {
          pending.push(entry)
          continue
        }
        try {
          const file = await entry.getFile()
          result.files++
          result.bytes += file.size
        } catch {
          result.skipped++
        }
        if (result.files % 200 === 0) options.onProgress?.({ ...result })
      }
    } catch (err) {
      if (options.signal?.aborted) throw err
      result.skipped++
    }
  }
  options.onProgress?.({ ...result })
  return result
}
