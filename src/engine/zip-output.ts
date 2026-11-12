// Where a ZIP archive is kept while it is being written. Worker only: the
// synchronous file access used here does not exist on the page.

import type { ZipOutput } from './host'

/** Temporary archives live under this name in the origin's private storage. */
const ZIP_PREFIX = 'restore-'

interface SyncAccess {
  write(bytes: Uint8Array, options: { at: number }): number
  flush(): void
  close(): void
}

/**
 * An archive is written to the origin's private file system, so that a
 * multi-gigabyte restore does not have to fit in memory. The page then
 * hands that file to the browser as a download. Browsers without it get an
 * in-memory archive instead.
 */
export async function openZip(): Promise<ZipOutput> {
  try {
    const root = await navigator.storage.getDirectory()
    const name = `${ZIP_PREFIX}${crypto.randomUUID()}.zip`
    const handle = await root.getFileHandle(name, { create: true })
    const access = await (handle as unknown as { createSyncAccessHandle(): Promise<SyncAccess> }).createSyncAccessHandle()
    let at = 0
    let open = true
    const close = () => {
      if (open) access.close()
      open = false
    }
    return {
      write(bytes) {
        access.write(bytes, { at })
        at += bytes.length
      },
      async finish() {
        access.flush()
        close()
        return { file: name }
      },
      async discard() {
        close()
        await root.removeEntry(name).catch(() => {})
      },
    }
  } catch {
    const parts: Uint8Array<ArrayBuffer>[] = []
    return {
      write: (bytes) => void parts.push(bytes.slice() as Uint8Array<ArrayBuffer>),
      finish: async () => ({ blob: new Blob(parts, { type: 'application/zip' }) }),
      discard: async () => void (parts.length = 0),
    }
  }
}
