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
}

const INDEX_AAD = 'xkyhold/v1/index'
const snapshotAad = (id: string) => `xkyhold/v1/snapshot/${id}`
const CONFIG = 'config'

export class Repository {
  private readonly index = new Map<string, Located>()
  private readonly writers: Partial<Record<BlobType, PackWriter>> = {}
  /** Blobs sitting in a pack that has not been uploaded yet. */
  private readonly open = new Map<BlobType, Set<string>>()
  /** Uploaded packs not yet recorded in an index file. */
  private unindexed: IndexFile['packs'] = []
  private readonly packSize: number
  private readonly indexEvery: number

  /** Bytes of packs uploaded by this instance. */
  uploadedBytes = 0

  constructor(
    readonly dest: Destination,
    readonly keys: RepoKeys,
    options: RepositoryOptions = {},
  ) {
    this.packSize = options.packSize ?? PACK_TARGET_SIZE
    this.indexEvery = options.indexEvery ?? 8
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
    this.index.clear()
    for (const { name } of await this.dest.list('index')) {
      const json = fromUtf8(await inflate(await open(this.keys.encKey, await this.dest.get('index', name), INDEX_AAD)))
      for (const pack of (JSON.parse(json) as IndexFile).packs) {
        for (const blob of pack.blobs) this.index.set(blob.id, { ...blob, pack: pack.id })
      }
    }
  }

  /** Is this blob safely stored (uploaded), or queued in an open pack? */
  has(id: string): boolean {
    return this.index.has(id) || this.isOpen(id)
  }

  private isOpen(id: string): boolean {
    for (const ids of this.open.values()) if (ids.has(id)) return true
    return false
  }

  get blobCount(): number {
    return this.index.size
  }

  private async writeIndex(signal?: AbortSignal): Promise<void> {
    if (this.unindexed.length === 0) return
    const file: IndexFile = { packs: this.unindexed }
    const sealed = await seal(this.keys.encKey, await deflate(utf8(JSON.stringify(file))), INDEX_AAD)
    await this.dest.put('index', await sha256Hex(sealed), sealed, signal)
    this.unindexed = []
  }

  // --- Blobs ------------------------------------------------------------

  /** Stores a blob unless the repository already has it. Returns its id. */
  async saveBlob(type: BlobType, plaintext: Uint8Array, signal?: AbortSignal): Promise<string> {
    const id = await blobId(this.keys, plaintext)
    if (this.has(id)) return id

    let writer = this.writers[type]
    if (writer && writer.count > 0 && writer.size + plaintext.length + SEAL_OVERHEAD > this.packSize) {
      await this.closePack(type, signal)
      writer = undefined
    }
    writer ??= this.writers[type] = new PackWriter(this.keys)
    await writer.add(type, plaintext, id)
    let ids = this.open.get(type)
    if (!ids) this.open.set(type, (ids = new Set()))
    ids.add(id)
    return id
  }

  private async closePack(type: BlobType, signal?: AbortSignal): Promise<void> {
    const writer = this.writers[type]
    if (!writer || writer.count === 0) return
    const pack = await writer.finish()
    await this.dest.put('packs', pack.name, pack.bytes, signal)
    // Only now are these blobs stored.
    delete this.writers[type]
    this.open.delete(type)
    this.uploadedBytes += pack.bytes.length
    for (const blob of pack.blobs) this.index.set(blob.id, { ...blob, pack: pack.name })
    this.unindexed.push({ id: pack.name, blobs: pack.blobs })
    if (this.unindexed.length >= this.indexEvery) await this.writeIndex(signal)
  }

  /** Uploads every open pack and writes the index. */
  async flush(signal?: AbortSignal): Promise<void> {
    await this.closePack('data', signal)
    await this.closePack('tree', signal)
    await this.writeIndex(signal)
  }

  /**
   * Forgets blobs that were queued but never uploaded. Must be called when
   * a backup fails, or `has` would keep claiming data that is not stored.
   */
  discardOpenPacks(): void {
    delete this.writers.data
    delete this.writers.tree
    this.open.clear()
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
    if (this.open.size > 0 || this.unindexed.length > 0) throw new Error('flush() must run before saveSnapshot()')
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
