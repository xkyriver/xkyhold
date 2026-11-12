/// <reference lib="webworker" />
// Entry point of the engine's Web Worker: the real Google Drive, wired to
// the message host.

import { Drive } from '../storage/drive'
import { DriveDestination } from '../storage/drive-destination'
import { createHost } from './host'
import type { Request } from './host'
import { openZip } from './zip-output'

const drive = new Drive()

// Development only: the page can move the engine's clock (`?pretend-now=`).
let clockOffset = 0

const handle = createHost(
  {
    destination: (repoName, token) => DriveDestination.forName(drive, token, repoName),
    openZip,
    listBackups: async (token) => (await DriveDestination.listRepositories(drive, token)).map((r) => r.name).sort(),
    ...(import.meta.env.DEV ? { now: () => new Date(Date.now() + clockOffset) } : {}),
  },
  (message) => self.postMessage(message),
)

self.onmessage = (event: MessageEvent<Request | { type: 'clock'; offset: number }>) => {
  const message = event.data
  if (message.type === 'clock') {
    if (import.meta.env.DEV) clockOffset = message.offset
    return
  }
  handle(message)
}
