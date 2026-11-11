// A repository: the index, blob storage and snapshots on top of a
// Destination (docs/FORMAT.md, sections 5 to 9).

import type { Destination } from '../storage/destination'
import { NotFoundError } from '../storage/destination'
import { deflate, fromUtf8, inflate, randomBytes, sha256Hex, toHex, utf8 } from './bytes'
import type { Bytes } from './bytes'
import {
  AuthenticationError,
  blobId,
  changePassword,
  createRepository,
  FormatError,
  open,
  seal,
  SEAL_OVERHEAD,
  unlockRepository,
} from './crypto'
import type { Argon2Params, Credential, RepoConfig, RepoKeys } from './crypto'
import { PACK_TARGET_SIZE, PackWriter, readBlob } from './pack'
import type { BlobEntry, BlobType } from './pack'

export interface TreeFile {
  name: string
  type: 'file'
  size: number
  /** Milliseconds since the Unix epoch. */
  mtime: number
  content: string[]
}

export interface TreeDir {
  name: string
  type: 'dir'
  subtree: string
}

export type TreeEntry = TreeFile | TreeDir

export interface Snapshot {
  id: string
  time: string
  device: string
  roots: { name: string; tree: string }[]
  stats: { files: number; bytes: number; skipped: number }
  parent: string | null
}

/** A blob the index does not know, or whose pack is gone. */
export class MissingBlobError extends Error {
  constructor(id: string) {
    super(`The backup is missing a piece of data (${id.slice(0, 12)}…)`)
    this.name = 'MissingBlobError'
  }
}

interface Located extends BlobEntry {
  pack: string
}

interface IndexFile {
  packs: { id: string; blobs: BlobEntry[] }[]
}

export interface RepositoryOptions {
  packSize?: number
  /** Write an index file after this many packs (the backup checkpoint). */
  indexEvery?: number
  /** How many packs may be uploading at once. */
  uploads?: number
}

const INDEX_AAD = 'xkyhold/v1/index'
const snapshotAad = (id: string) => `xkyhold/v1/snapshot/${id}`
const CONFIG = 'config'

export class Repository {
  private readonly index = new Map<string, Located>()
  private readonly writers: Partial<Record<BlobType, PackWriter>> = {}
  /** Blobs in a pack that is still being filled or uploaded: not stored yet. */
  private readonly pending = new Set<string>()
  /** Packs being uploaded right now. */
  private readonly uploading = new Set<Promise<void>>()
  /** The first upload failure, reported at the next saveBlob or flush. */
  private uploadError: { error: unknown } | null = null
  /** Uploaded packs not yet recorded in an index file. */
  private unindexed: IndexFile['packs'] = []
  private readonly packSize: number
  private readonly indexEvery: number
  private readonly maxUploads: number

  /** Bytes of packs uploaded by this instance. */
  uploadedBytes = 0

  constructor(
    readonly dest: Destination,
    readonly keys: RepoKeys,
    options: RepositoryOptions = {},
  ) {
    this.packSize = options.packSize ?? PACK_TARGET_SIZE
    this.indexEvery = options.indexEvery ?? 8
    this.maxUploads = Math.max(1, options.uploads ?? 3)
  }

  /** Creates a new repository in an empty destination. */
  static async create(
    dest: Destination,
    password: string,
    options: RepositoryOptions & { argon2?: Argon2Params } = {},
  ): Promise<{ repo: Repository; recoveryKey: string }> {
    const { config, keys, recoveryKey } = await createRepository(password, options.argon2)
    await dest.put('', CONFIG, utf8(JSON.stringify(config, null, 2)))
    return { repo: new Repository(dest, keys, options), recoveryKey }
  }

  static async readConfig(dest: Destination): Promise<RepoConfig> {
    try {
      return JSON.parse(fromUtf8(await dest.get('', CONFIG)))
    } catch (err) {
      if (err instanceof NotFoundError) throw err
      throw new FormatError('This is not an XkyHold backup')
    }
  }

  /** Opens an existing repository and loads its index. */
  static async open(dest: Destination, credential: Credential, options: RepositoryOptions = {}): Promise<Repository> {
    const keys = await unlockRepository(await Repository.readConfig(dest), credential)
    const repo = new Repository(dest, keys, options)
    await repo.loadIndex()
    return repo
  }

  static async changePassword(
    dest: Destination,
    credential: Credential,
    newPassword: string,
    argon2?: Argon2Params,
  ): Promise<void> {
    const updated = await changePassword(await Repository.readConfig(dest), credential, newPassword, argon2)
    await dest.put('', CONFIG, utf8(JSON.stringify(updated, null, 2)))
  }

  // --- Index ------------------------------------------------------------

  async loadIndex(): Promise<void> {
    const names = (await this.dest.list('index')).map((o) => o.name)
    const files = await Promise.all(
      names.map(async (name) => {
        const sealed = await this.dest.get('index', name)
        return JSON.parse(fromUtf8(await inflate(await open(this.keys.encKey, sealed, INDEX_AAD)))) as IndexFile
      }),
    )
    this.index.clear()
    for (const file of files) {
      for (const pack of file.packs) {
        for (const blob of pack.blobs) this.index.set(blob.id, { ...blob, pack: pack.id })
      }
    }
  }

  /** Is this blob stored, or on its way (in a pack being filled or uploaded)? */
  has(id: string): boolean {
    return this.index.has(id) || this.pending.has(id)
  }

  get blobCount(): number {
    return this.index.size
  }

  private async writeIndex(signal?: AbortSignal): Promise<void> {
    if (this.unindexed.length === 0) return
    const batch = this.unindexed
    this.unindexed = []
    try {
      const sealed = await seal(this.keys.encKey, await deflate(utf8(JSON.stringify({ packs: batch } satisfies IndexFile))), INDEX_AAD)
      await this.dest.put('index', await sha256Hex(sealed), sealed, signal)
    } catch (err) {
      this.unindexed = [...batch, ...this.unindexed]
      throw err
    }
  }

  // --- Blobs ------------------------------------------------------------

  private throwIfUploadFailed(): void {
    if (this.uploadError) throw this.uploadError.error
  }

  /** Stores a blob unless the repository already has it. Returns its id. */
  async saveBlob(type: BlobType, plaintext: Uint8Array, signal?: AbortSignal): Promise<string> {
    this.throwIfUploadFailed()
    const id = await blobId(this.keys, plaintext)
    if (this.has(id)) return id

    let writer = this.writers[type]
    if (writer && writer.count > 0 && writer.size + plaintext.length + SEAL_OVERHEAD > this.packSize) {
      await this.closePack(type, signal)
      writer = undefined
    }
    writer ??= this.writers[type] = new PackWriter(this.keys)
    this.pending.add(id)
    await writer.add(type, plaintext, id)
    return id
  }

  /**
   * Hands a full pack to the uploader and returns as soon as it has
   * started, so reading can go on. Waits only when too many are in flight,
   * which also bounds the memory held by packs waiting to go out.
   */
  private async closePack(type: BlobType, signal?: AbortSignal): Promise<void> {
    const writer = this.writers[type]
    if (!writer || writer.count === 0) return
    delete this.writers[type]
    const pack = await writer.finish()
    while (this.uploading.size >= this.maxUploads) await Promise.race(this.uploading)
    this.throwIfUploadFailed()

    const upload = (async () => {
      await this.dest.put('packs', pack.name, pack.bytes, signal)
      // Only now are these blobs stored.
      this.uploadedBytes += pack.bytes.length
      for (const blob of pack.blobs) {
        this.index.set(blob.id, { ...blob, pack: pack.name })
        this.pending.delete(blob.id)
      }
      this.unindexed.push({ id: pack.name, blobs: pack.blobs })
      if (this.unindexed.length >= this.indexEvery) await this.writeIndex(signal)
    })()
      .catch((error) => void (this.uploadError ??= { error }))
      .finally(() => this.uploading.delete(upload))
    this.uploading.add(upload)
  }

  /** Uploads every open pack, waits for all uploads, and writes the index. */
  async flush(signal?: AbortSignal): Promise<void> {
    await this.closePack('data', signal)
    await this.closePack('tree', signal)
    while (this.uploading.size > 0) await Promise.all(this.uploading)
    this.throwIfUploadFailed()
    await this.writeIndex(signal)
  }

  /**
   * Forgets blobs that were queued but never stored. Must be called when a
   * backup fails, or `has` would keep claiming data that is not there.
   */
  async abandon(): Promise<void> {
    delete this.writers.data
    delete this.writers.tree
    while (this.uploading.size > 0) await Promise.all(this.uploading)
    this.pending.clear()
    this.uploadError = null
  }

  async loadBlob(type: BlobType, id: string): Promise<Bytes> {
    const located = this.index.get(id)
    if (!located) throw new MissingBlobError(id)
    if (located.type !== type) throw new AuthenticationError('Blob has the wrong type')
    let sealed: Bytes
    try {
      sealed = await this.dest.get('packs', located.pack, { offset: located.offset, length: located.length })
    } catch (err) {
      if (err instanceof NotFoundError) throw new MissingBlobError(id)
      throw err
    }
    return readBlob(this.keys, located, sealed)
  }

  // --- Trees ------------------------------------------------------------

  saveTree(entries: TreeEntry[], signal?: AbortSignal): Promise<string> {
    return this.saveBlob('tree', utf8(JSON.stringify({ entries })), signal)
  }

  async loadTree(id: string): Promise<TreeEntry[]> {
    return (JSON.parse(fromUtf8(await this.loadBlob('tree', id))) as { entries: TreeEntry[] }).entries
  }

  // --- Snapshots --------------------------------------------------------

  /** Writes a snapshot. Everything it refers to must already be flushed. */
  async saveSnapshot(snapshot: Omit<Snapshot, 'id'>, signal?: AbortSignal): Promise<Snapshot> {
    if (this.pending.size > 0 || this.unindexed.length > 0) throw new Error('flush() must run before saveSnapshot()')
    const full: Snapshot = { id: toHex(randomBytes(16)), ...snapshot }
    const sealed = await seal(this.keys.encKey, await deflate(utf8(JSON.stringify(full))), snapshotAad(full.id))
    await this.dest.put('snapshots', full.id, sealed, signal)
    return full
  }

  async loadSnapshot(id: string): Promise<Snapshot> {
    const sealed = await this.dest.get('snapshots', id)
    return JSON.parse(fromUtf8(await inflate(await open(this.keys.encKey, sealed, snapshotAad(id)))))
  }

  /** All snapshots, oldest first. */
  async listSnapshots(): Promise<Snapshot[]> {
    const names = new Set((await this.dest.list('snapshots')).map((o) => o.name))
    const snapshots = await Promise.all([...names].map((id) => this.loadSnapshot(id)))
    return snapshots.sort((a, b) => a.time.localeCompare(b.time))
  }
}
