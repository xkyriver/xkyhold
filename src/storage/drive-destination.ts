// A repository stored in a Google Drive folder.

import type { Bytes } from '../engine/bytes'
import { NotFoundError } from './destination'
import type { Destination, Dir, StoredObject } from './destination'
import { DRIVE_FOLDER_MIME, DriveError, uploadResumable } from './drive'
import type { Drive, DriveFile } from './drive'

/** The app's folder in the user's Drive; repositories are its sub-folders. */
export const APP_FOLDER = 'XkyHold'

/** Above this size an upload is resumable; below, a single request. */
const SMALL_UPLOAD = 4 * 1024 * 1024

export type TokenSource = () => Promise<string>

const SUBFOLDERS: Exclude<Dir, ''>[] = ['packs', 'index', 'snapshots', 'locks']
const RETRY_DELAYS_MS = [500, 1500, 4000]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Rate limits, server errors and dropped connections are worth retrying. */
const isTransient = (err: unknown) => (err instanceof DriveError && err.transient) || err instanceof TypeError

export class DriveDestination implements Destination {
  private readonly folders = new Map<Dir, Promise<string>>()
  /** name -> file id, per folder, filled on first use. */
  private readonly listings = new Map<Dir, Promise<Map<string, DriveFile>>>()
  /** The repository's sub-folders that already exist, from one listing. */
  private existing: Promise<Map<string, string>> | null = null
  /** Waits between retries; replaced in tests. */
  wait = sleep

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

  /** Repeats `work` a few times when Drive is briefly unavailable. */
  private async retry<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work()
      } catch (err) {
        if (signal?.aborted || !isTransient(err) || attempt >= RETRY_DELAYS_MS.length) throw err
        await this.wait(RETRY_DELAYS_MS[attempt])
      }
    }
  }

  private subfolders(): Promise<Map<string, string>> {
    if (!this.existing) {
      this.existing = this.retry(async () => {
        const children = await this.drive.listChildren(await this.token(), this.repoFolder)
        return new Map(children.filter((f) => f.mimeType === DRIVE_FOLDER_MIME).map((f) => [f.name, f.id]))
      })
      this.existing.catch(() => (this.existing = null))
    }
    return this.existing
  }

  private folder(dir: Dir): Promise<string> {
    let id = this.folders.get(dir)
    if (!id) {
      id = this.subfolders().then(
        async (existing) =>
          existing.get(dir) ?? this.retry(async () => this.drive.createFolder(await this.token(), dir, this.repoFolder)),
      )
      this.folders.set(dir, id)
      id.catch(() => this.folders.delete(dir))
    }
    return id
  }

  /**
   * Resolves every folder and listing at once, so that the first backup or
   * restore does not pay for them one request at a time.
   */
  async warm(): Promise<void> {
    await Promise.all(SUBFOLDERS.filter((d) => d !== 'locks').map((dir) => this.listing(dir)))
  }

  private listing(dir: Dir): Promise<Map<string, DriveFile>> {
    let listing = this.listings.get(dir)
    if (!listing) {
      listing = (async () => {
        const created = !(await this.subfolders()).has(dir) && dir !== ''
        const folder = await this.folder(dir)
        // A folder this session just created is known to be empty.
        const files = created ? [] : await this.retry(async () => this.drive.listChildren(await this.token(), folder))
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
    if (existing) {
      // Everything but the root (config) is named after its content or a
      // random id and never changes: if it is there, it is already right.
      if (dir === '') {
        await this.retry(async () => this.drive.replaceContent(await this.token(), existing.id, data, signal), signal)
      }
      return
    }
    const folder = await this.folder(dir)
    let file: DriveFile
    if (data.length <= SMALL_UPLOAD) {
      file = await this.retry(async () => this.drive.uploadSmall(await this.token(), name, folder, data, signal), signal)
    } else {
      const session = await this.retry(async () => this.drive.startUpload(await this.token(), name, folder, data.length), signal)
      const blob = new Blob([data as Bytes])
      // First attempt starts at zero; a retry asks the server where it stopped.
      let fresh = true
      file = await this.retry(async () => {
        const options = { signal, fresh }
        fresh = false
        return uploadResumable(this.drive, session, blob, options)
      }, signal)
    }
    listing.set(name, { id: file.id, name, size: String(data.length) })
  }

  async get(dir: Dir, name: string, range?: { offset: number; length: number }): Promise<Bytes> {
    const file = (await this.listing(dir)).get(name)
    if (!file) throw new NotFoundError(dir, name)
    return this.retry(async () => this.drive.download(await this.token(), file.id, range))
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
    await this.retry(async () => this.drive.trashFile(await this.token(), file.id))
    listing.delete(name)
  }
}
