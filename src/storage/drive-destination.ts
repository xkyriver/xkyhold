// A repository stored in a Google Drive folder.

import type { Bytes } from '../engine/bytes'
import { NotFoundError } from './destination'
import type { Destination, Dir, StoredObject } from './destination'
import { DRIVE_FOLDER_MIME, uploadResumable } from './drive'
import type { Drive, DriveFile } from './drive'

/** The app's folder in the user's Drive; repositories are its sub-folders. */
export const APP_FOLDER = 'XkyHold'

/** Above this size an upload is resumable; below, a single request. */
const SMALL_UPLOAD = 4 * 1024 * 1024

export type TokenSource = () => Promise<string>

export class DriveDestination implements Destination {
  private readonly folders = new Map<Dir, Promise<string>>()
  /** name -> file id, per folder, filled on first use. */
  private readonly listings = new Map<Dir, Promise<Map<string, DriveFile>>>()

  constructor(
    private readonly drive: Drive,
    private readonly token: TokenSource,
    private readonly repoFolder: string,
  ) {
    this.folders.set('', Promise.resolve(repoFolder))
  }

  /** The repositories in the user's Drive, by folder name. */
  static async listRepositories(drive: Drive, token: TokenSource): Promise<{ id: string; name: string }[]> {
    const t = await token()
    const app = await drive.ensureFolder(t, APP_FOLDER)
    return (await drive.listChildren(t, app))
      .filter((f) => f.mimeType === DRIVE_FOLDER_MIME)
      .map(({ id, name }) => ({ id, name }))
  }

  /** Opens the repository folder called `name`, creating it if missing. */
  static async forName(drive: Drive, token: TokenSource, name: string): Promise<DriveDestination> {
    const t = await token()
    const app = await drive.ensureFolder(t, APP_FOLDER)
    return new DriveDestination(drive, token, await drive.ensureFolder(t, name, app))
  }

  private folder(dir: Dir): Promise<string> {
    let id = this.folders.get(dir)
    if (!id) {
      id = this.token().then((t) => this.drive.ensureFolder(t, dir, this.repoFolder))
      this.folders.set(dir, id)
      id.catch(() => this.folders.delete(dir))
    }
    return id
  }

  private listing(dir: Dir): Promise<Map<string, DriveFile>> {
    let listing = this.listings.get(dir)
    if (!listing) {
      listing = (async () => {
        const files = await this.drive.listChildren(await this.token(), await this.folder(dir))
        const map = new Map<string, DriveFile>()
        // Drive allows duplicate names; any one will do (see FORMAT.md, 3).
        for (const file of files) if (file.mimeType !== DRIVE_FOLDER_MIME) map.set(file.name, file)
        return map
      })()
      this.listings.set(dir, listing)
      listing.catch(() => this.listings.delete(dir))
    }
    return listing
  }

  async put(dir: Dir, name: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    const listing = await this.listing(dir)
    const existing = listing.get(name)
    const token = await this.token()
    if (existing) {
      // Everything but the root (config) is named after its content or a
      // random id and never changes: if it is there, it is already right.
      if (dir === '') await this.drive.replaceContent(token, existing.id, data, signal)
      return
    }
    const folder = await this.folder(dir)
    let file: DriveFile
    if (data.length <= SMALL_UPLOAD) {
      file = await this.drive.uploadSmall(token, name, folder, data, signal)
    } else {
      const session = await this.drive.startUpload(token, name, folder, data.length)
      file = await uploadResumable(this.drive, session, new Blob([data as Bytes]), { signal, fresh: true })
    }
    listing.set(name, { id: file.id, name, size: String(data.length) })
  }

  async get(dir: Dir, name: string, range?: { offset: number; length: number }): Promise<Bytes> {
    const file = (await this.listing(dir)).get(name)
    if (!file) throw new NotFoundError(dir, name)
    return this.drive.download(await this.token(), file.id, range)
  }

  async list(dir: Dir): Promise<StoredObject[]> {
    return [...(await this.listing(dir)).values()].map((f) => ({
      name: f.name,
      size: Number(f.size ?? 0),
      sha256: f.sha256Checksum,
    }))
  }

  async trash(dir: Dir, name: string): Promise<void> {
    const listing = await this.listing(dir)
    const file = listing.get(name)
    if (!file) throw new NotFoundError(dir, name)
    await this.drive.trashFile(await this.token(), file.id)
    listing.delete(name)
  }
}
