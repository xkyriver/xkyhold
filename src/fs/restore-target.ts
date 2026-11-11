// Writes restored files into a real folder through the File System Access
// API. The browser cannot set modification times, so restored files carry
// the time of the restore (docs/FORMAT.md, section 2).

import type { Bytes } from '../engine/bytes'
import type { TreeFile } from '../engine/repo'
import type { RestoreTarget } from '../engine/restore'

interface WritableLike {
  write(data: Bytes): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

interface WritableDir {
  getDirectoryHandle(name: string, options: { create: true }): Promise<WritableDir>
  getFileHandle(name: string, options: { create: true }): Promise<{ createWritable(): Promise<WritableLike> }>
}

export class FolderTarget implements RestoreTarget {
  constructor(private readonly dir: WritableDir) {}

  /** Asks the user where to restore to. Returns null if they cancel. */
  static async pick(): Promise<FolderTarget | null> {
    const picker = (window as unknown as { showDirectoryPicker(options?: object): Promise<WritableDir> }).showDirectoryPicker
    try {
      return new FolderTarget(await picker.call(window, { mode: 'readwrite' }))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    }
  }

  async createDir(name: string): Promise<RestoreTarget> {
    return new FolderTarget(await this.dir.getDirectoryHandle(name, { create: true }))
  }

  async writeFile(file: TreeFile, chunks: AsyncIterable<Bytes>): Promise<void> {
    const handle = await this.dir.getFileHandle(file.name, { create: true })
    const writable = await handle.createWritable()
    try {
      for await (const chunk of chunks) await writable.write(chunk)
      await writable.close()
    } catch (err) {
      // Nothing is left behind: the browser only replaces the file on close.
      await writable.abort().catch(() => {})
      throw err
    }
  }
}

/** A target that checks every byte but writes nothing: "verify my backup". */
export class VerifyTarget implements RestoreTarget {
  async createDir(): Promise<RestoreTarget> {
    return this
  }

  async writeFile(file: TreeFile, chunks: AsyncIterable<Bytes>): Promise<void> {
    let size = 0
    for await (const chunk of chunks) size += chunk.length
    if (size !== file.size) throw new Error(`${file.name} has the wrong size in the backup`)
  }
}
