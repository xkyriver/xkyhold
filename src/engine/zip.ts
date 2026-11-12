// A streaming ZIP writer and a restore target built on it.
//
// Files are stored, not compressed: restore speed matters more than size,
// and most large personal files are compressed already. Because a file's
// checksum is only known after its data has gone by, each file is followed
// by a data descriptor. ZIP64 is used only where a size, an offset or the
// number of entries needs it, so small archives open everywhere.
//
// Unlike a restore into a folder, a ZIP keeps each file's original
// modification time.

import { concat, utf8 } from './bytes'
import type { Bytes } from './bytes'
import type { TreeFile } from './repo'
import type { RestoreTarget } from './restore'

/** Where the archive's bytes go, in order. */
export interface ZipSink {
  write(bytes: Uint8Array): Promise<void> | void
}

const MAX32 = 0xffffffff
const MAX16 = 0xffff
const FLAG_DESCRIPTOR = 0x0008
const FLAG_UTF8 = 0x0800
const VERSION_DEFAULT = 20
const VERSION_ZIP64 = 45
/** "Made by": Unix (3), so the permission bits below are honoured. */
const MADE_BY = (3 << 8) | VERSION_ZIP64
const MODE_FILE = 0o100644
const MODE_DIR = 0o040755

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

/** A little-endian record builder. */
class Record {
  private readonly view: DataView
  private offset = 0

  constructor(readonly bytes: Bytes) {
    this.view = new DataView(bytes.buffer)
  }

  static of(length: number): Record {
    return new Record(new Uint8Array(length))
  }

  u16(value: number): this {
    this.view.setUint16(this.offset, value, true)
    this.offset += 2
    return this
  }

  u32(value: number): this {
    this.view.setUint32(this.offset, value >>> 0, true)
    this.offset += 4
    return this
  }

  u64(value: number): this {
    this.view.setBigUint64(this.offset, BigInt(value), true)
    this.offset += 8
    return this
  }

  raw(bytes: Uint8Array): this {
    this.bytes.set(bytes, this.offset)
    this.offset += bytes.length
    return this
  }
}

/** MS-DOS date and time, in local time, two-second resolution. */
function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms)
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  }
}

/** "Extended timestamp" extra field: the exact modification time, in UTC. */
function timestampExtra(ms: number): Bytes {
  const seconds = Math.min(Math.max(Math.floor(ms / 1000), 0), MAX32)
  return Record.of(9).u16(0x5455).u16(5).raw(new Uint8Array([1])).u32(seconds).bytes
}

interface Entry {
  name: Bytes
  directory: boolean
  mtime: number
  crc: number
  size: number
  offset: number
  zip64: boolean
}

export class ZipWriter {
  private readonly entries: Entry[] = []
  private offset = 0

  constructor(
    private readonly sink: ZipSink,
    /** Test hook: use ZIP64 records even for small archives. */
    private readonly forceZip64 = false,
  ) {}

  /** Bytes written so far. */
  get size(): number {
    return this.offset
  }

  private async put(bytes: Uint8Array): Promise<void> {
    await this.sink.write(bytes)
    this.offset += bytes.length
  }

  private localHeader(entry: Entry): Bytes {
    const { date, time } = dosDateTime(entry.mtime)
    const extra = entry.zip64
      ? concat(Record.of(20).u16(0x0001).u16(16).u64(0).u64(0).bytes, timestampExtra(entry.mtime))
      : timestampExtra(entry.mtime)
    const streamed = entry.directory ? 0 : FLAG_DESCRIPTOR
    return Record.of(30 + entry.name.length + extra.length)
      .u32(0x04034b50)
      .u16(entry.zip64 ? VERSION_ZIP64 : VERSION_DEFAULT)
      .u16(FLAG_UTF8 | streamed)
      .u16(0) // stored
      .u16(time)
      .u16(date)
      .u32(0) // crc: in the data descriptor
      .u32(entry.zip64 ? MAX32 : 0)
      .u32(entry.zip64 ? MAX32 : 0)
      .u16(entry.name.length)
      .u16(extra.length)
      .raw(entry.name)
      .raw(extra).bytes
  }

  /** `path` uses "/" between folders and has no leading slash. */
  async addDirectory(path: string, mtime: number = Date.now()): Promise<void> {
    const entry: Entry = { name: utf8(`${path}/`), directory: true, mtime, crc: 0, size: 0, offset: this.offset, zip64: false }
    await this.put(this.localHeader(entry))
    this.entries.push(entry)
  }

  /**
   * Adds a file from its chunks. `expectedSize` only decides whether the
   * entry needs ZIP64; the real size is whatever the chunks add up to.
   */
  async addFile(path: string, mtime: number, expectedSize: number, chunks: AsyncIterable<Uint8Array>): Promise<void> {
    const entry: Entry = {
      name: utf8(path),
      directory: false,
      mtime,
      crc: 0,
      size: 0,
      offset: this.offset,
      zip64: this.forceZip64 || expectedSize >= MAX32,
    }
    await this.put(this.localHeader(entry))
    for await (const chunk of chunks) {
      entry.crc = crc32(chunk, entry.crc)
      entry.size += chunk.length
      await this.put(chunk)
    }
    if (!entry.zip64 && entry.size >= MAX32) throw new Error(`${path} is larger than its backup record says`)
    const descriptor = entry.zip64
      ? Record.of(24).u32(0x08074b50).u32(entry.crc).u64(entry.size).u64(entry.size)
      : Record.of(16).u32(0x08074b50).u32(entry.crc).u32(entry.size).u32(entry.size)
    await this.put(descriptor.bytes)
    this.entries.push(entry)
  }

  private centralHeader(entry: Entry): Bytes {
    const { date, time } = dosDateTime(entry.mtime)
    const bigSize = entry.zip64
    const bigOffset = this.forceZip64 || entry.offset >= MAX32
    const fields = (bigSize ? 2 : 0) + (bigOffset ? 1 : 0)
    const zip64 = Record.of(fields ? 4 + fields * 8 : 0)
    if (fields) {
      zip64.u16(0x0001).u16(fields * 8)
      if (bigSize) zip64.u64(entry.size).u64(entry.size)
      if (bigOffset) zip64.u64(entry.offset)
    }
    const extra = concat(zip64.bytes, timestampExtra(entry.mtime))
    return Record.of(46 + entry.name.length + extra.length)
      .u32(0x02014b50)
      .u16(MADE_BY)
      .u16(fields ? VERSION_ZIP64 : VERSION_DEFAULT)
      .u16(FLAG_UTF8 | (entry.directory ? 0 : FLAG_DESCRIPTOR))
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(entry.crc)
      .u32(bigSize ? MAX32 : entry.size)
      .u32(bigSize ? MAX32 : entry.size)
      .u16(entry.name.length)
      .u16(extra.length)
      .u16(0) // comment
      .u16(0) // disk
      .u16(0) // internal attributes
      .u32((((entry.directory ? MODE_DIR : MODE_FILE) << 16) | (entry.directory ? 0x10 : 0)) >>> 0)
      .u32(bigOffset ? MAX32 : entry.offset)
      .raw(entry.name)
      .raw(extra).bytes
  }

  /** Writes the central directory. Nothing may be added afterwards. */
  async finish(): Promise<void> {
    const start = this.offset
    for (const entry of this.entries) await this.put(this.centralHeader(entry))
    const size = this.offset - start
    const count = this.entries.length

    if (this.forceZip64 || count >= MAX16 || size >= MAX32 || start >= MAX32) {
      const record = this.offset
      await this.put(
        Record.of(56)
          .u32(0x06064b50)
          .u64(44)
          .u16(MADE_BY)
          .u16(VERSION_ZIP64)
          .u32(0)
          .u32(0)
          .u64(count)
          .u64(count)
          .u64(size)
          .u64(start).bytes,
      )
      await this.put(Record.of(20).u32(0x07064b50).u32(0).u64(record).u32(1).bytes)
    }
    await this.put(
      Record.of(22)
        .u32(0x06054b50)
        .u16(0)
        .u16(0)
        .u16(Math.min(count, MAX16))
        .u16(Math.min(count, MAX16))
        .u32(Math.min(size, MAX32))
        .u32(Math.min(start, MAX32))
        .u16(0).bytes,
    )
  }
}

/** A name that cannot escape its folder, whatever the backup contains. */
function safeName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, '_')
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned
}

/**
 * Restores into a ZIP archive. Restore runs several files at once, but an
 * archive is one stream, so files queue here and are written one by one.
 */
export class ZipTarget implements RestoreTarget {
  private constructor(
    private readonly zip: ZipWriter,
    private readonly prefix: string,
    private readonly queue: { tail: Promise<void> },
  ) {}

  static root(zip: ZipWriter): ZipTarget {
    return new ZipTarget(zip, '', { tail: Promise.resolve() })
  }

  private inOrder(work: () => Promise<void>): Promise<void> {
    const run = this.queue.tail.then(work)
    this.queue.tail = run.catch(() => {})
    return run
  }

  async createDir(name: string): Promise<RestoreTarget> {
    const path = this.prefix + safeName(name)
    await this.inOrder(() => this.zip.addDirectory(path))
    return new ZipTarget(this.zip, `${path}/`, this.queue)
  }

  writeFile(file: TreeFile, chunks: AsyncIterable<Bytes>): Promise<void> {
    return this.inOrder(() => this.zip.addFile(this.prefix + safeName(file.name), file.mtime, file.size, chunks))
  }
}
