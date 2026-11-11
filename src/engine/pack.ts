// Pack files (docs/FORMAT.md, sections 5 and 6): encrypted blobs back to
// back, followed by an encrypted header that lists them.

import { concat, deflate, fromUtf8, inflate, sha256Hex, utf8 } from './bytes'
import type { Bytes } from './bytes'
import { AuthenticationError, blobId, FormatError, open, seal } from './crypto'
import type { RepoKeys } from './crypto'

export type BlobType = 'data' | 'tree'

export const ENCODING_RAW = 0
export const ENCODING_DEFLATE = 1

export interface BlobEntry {
  id: string
  type: BlobType
  /** Position of the encrypted blob inside the pack. */
  offset: number
  /** Length of the encrypted blob. */
  length: number
  /** Length of the plaintext. */
  rawLength: number
  encoding: number
}

export interface FinishedPack {
  /** Hex SHA-256 of `bytes`: the pack's name in Drive. */
  name: string
  bytes: Bytes
  blobs: BlobEntry[]
}

const MAGIC = utf8('XKH1')
const HEADER_AAD = 'xkyhold/v1/pack-header'
const LENGTH_FIELD = 4
export const PACK_TARGET_SIZE = 16 * 1024 * 1024

const blobAad = (type: BlobType, id: string) => `xkyhold/v1/blob/${type}/${id}`

export class PackWriter {
  private readonly parts: Uint8Array[] = [MAGIC]
  private readonly blobs: BlobEntry[] = []
  private offset = MAGIC.length

  constructor(private readonly keys: RepoKeys) {}

  /** Bytes of blob data written so far. */
  get size(): number {
    return this.offset
  }

  get count(): number {
    return this.blobs.length
  }

  /** Encrypts a blob into the pack and returns its entry. */
  async add(type: BlobType, plaintext: Uint8Array, id?: string): Promise<BlobEntry> {
    const blobIdHex = id ?? (await blobId(this.keys, plaintext))
    const encoding = type === 'tree' ? ENCODING_DEFLATE : ENCODING_RAW
    const body = encoding === ENCODING_DEFLATE ? await deflate(plaintext) : plaintext
    const sealed = await seal(this.keys.encKey, body, blobAad(type, blobIdHex))
    const entry: BlobEntry = {
      id: blobIdHex,
      type,
      offset: this.offset,
      length: sealed.length,
      rawLength: plaintext.length,
      encoding,
    }
    this.parts.push(sealed)
    this.blobs.push(entry)
    this.offset += sealed.length
    return entry
  }

  async finish(): Promise<FinishedPack> {
    const header = await seal(
      this.keys.encKey,
      await deflate(utf8(JSON.stringify({ blobs: this.blobs }))),
      HEADER_AAD,
    )
    const length = new Uint8Array(LENGTH_FIELD)
    new DataView(length.buffer).setUint32(0, header.length, true)
    const bytes = concat(...this.parts, header, length)
    return { name: await sha256Hex(bytes), bytes, blobs: [...this.blobs] }
  }
}

/** Reads the blob list from a whole pack. Used to rebuild a lost index. */
export async function readPackHeader(keys: RepoKeys, pack: Uint8Array): Promise<BlobEntry[]> {
  if (pack.length < MAGIC.length + LENGTH_FIELD || !MAGIC.every((b, i) => pack[i] === b)) {
    throw new FormatError('This is not an XkyHold pack')
  }
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength)
  const headerLength = view.getUint32(pack.length - LENGTH_FIELD, true)
  const headerStart = pack.length - LENGTH_FIELD - headerLength
  if (headerStart < MAGIC.length) throw new FormatError('Pack header is damaged')
  const sealed = pack.subarray(headerStart, pack.length - LENGTH_FIELD)
  const json = fromUtf8(await inflate(await open(keys.encKey, sealed, HEADER_AAD)))
  return (JSON.parse(json) as { blobs: BlobEntry[] }).blobs
}

/**
 * Decrypts one blob. `sealed` is exactly bytes [offset, offset + length)
 * of the pack. The plaintext is checked against the blob id before it is
 * returned, so a caller never sees unverified data.
 */
export async function readBlob(keys: RepoKeys, entry: BlobEntry, sealed: Uint8Array): Promise<Bytes> {
  if (sealed.length !== entry.length) throw new AuthenticationError('Blob has the wrong length')
  const body = await open(keys.encKey, sealed, blobAad(entry.type, entry.id))
  let plaintext: Bytes
  if (entry.encoding === ENCODING_RAW) plaintext = body
  else if (entry.encoding === ENCODING_DEFLATE) plaintext = await inflate(body)
  else throw new FormatError(`Unknown blob encoding ${entry.encoding}`)
  if (plaintext.length !== entry.rawLength || (await blobId(keys, plaintext)) !== entry.id) {
    throw new AuthenticationError('Blob content does not match its id')
  }
  return plaintext
}
