import type { DirHandleLike, FileHandleLike } from './handles'

export interface ScanResult {
  files: number
  bytes: number
  /** Entries that could not be read (locked, vanished, permission). */
  skipped: number
}

export interface ScanOptions {
  /** Sub-folders not to count, as paths inside the root ("Downloads", "Work/Old"). */
  leaveOut?: string[]
  onProgress?: (soFar: ScanResult) => void
  signal?: AbortSignal
}

/** Totals one chosen file, the way scanFolder totals a folder. */
export async function scanFile(file: FileHandleLike): Promise<ScanResult> {
  try {
    return { files: 1, bytes: (await file.getFile()).size, skipped: 0 }
  } catch {
    return { files: 0, bytes: 0, skipped: 1 }
  }
}

/**
 * Walks a folder and totals its files. Unreadable entries are counted as
 * skipped rather than failing the walk — one locked file must not stop a
 * backup.
 */
export async function scanFolder(root: DirHandleLike, options: ScanOptions = {}): Promise<ScanResult> {
  const result: ScanResult = { files: 0, bytes: 0, skipped: 0 }
  const leaveOut = new Set(options.leaveOut ?? [])
  const pending: { dir: DirHandleLike; rel: string }[] = [{ dir: root, rel: '' }]

  while (pending.length > 0) {
    const { dir, rel } = pending.pop()!
    try {
      for await (const entry of dir.values()) {
        options.signal?.throwIfAborted()
        if (entry.kind === 'directory') {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name
          if (!leaveOut.has(childRel)) pending.push({ dir: entry, rel: childRel })
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
