/// <reference lib="webworker" />
// Entry point of the engine's Web Worker: the real Google Drive, wired to
// the message host.

import { Drive } from '../storage/drive'
import { DriveDestination } from '../storage/drive-destination'
import { createHost } from './host'
import type { Request } from './host'

const drive = new Drive()

const handle = createHost(
  {
    destination: (repoName, token) => DriveDestination.forName(drive, token, repoName),
    listBackups: async (token) => (await DriveDestination.listRepositories(drive, token)).map((r) => r.name).sort(),
  },
  (message) => self.postMessage(message),
)

self.onmessage = (event: MessageEvent<Request>) => handle(event.data)
