// What this browser lets XkyHold do. Backing up needs to read folders from
// disk (File System Access API, Chromium desktop only); restoring works
// anywhere, because files can always be downloaded.

export type Mode = 'full' | 'restore-only' | 'unsupported'

export interface Capabilities {
  /** Can pick and re-read local folders (showDirectoryPicker). */
  folderAccess: boolean
  /** WebCrypto + IndexedDB + Web Workers: the minimum to decrypt a backup. */
  core: boolean
  mode: Mode
}

interface Env {
  showDirectoryPicker?: unknown
  crypto?: { subtle?: unknown }
  indexedDB?: unknown
  Worker?: unknown
  isSecureContext?: boolean
}

export function detectCapabilities(env: Env = globalThis as Env): Capabilities {
  const core =
    env.isSecureContext === true &&
    typeof env.crypto?.subtle === 'object' &&
    env.crypto.subtle !== null &&
    env.indexedDB != null &&
    typeof env.Worker === 'function'
  const folderAccess = core && typeof env.showDirectoryPicker === 'function'
  const mode: Mode = !core ? 'unsupported' : folderAccess ? 'full' : 'restore-only'
  return { folderAccess, core, mode }
}
