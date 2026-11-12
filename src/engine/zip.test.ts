import { describe, expect, it } from 'vitest'
import { MemoryDestination } from '../storage/memory'
import { backup } from './backup'
import { concat, fromUtf8, utf8 } from './bytes'
import type { Bytes } from './bytes'
import { Repository } from './repo'
import { restoreEntries } from './restore'
import { FakeDir, FakeFile, noise } from './testing'
import { crc32, ZipTarget, ZipWriter } from './zip'

class MemorySink {
  parts: Uint8Array[] = []
  write(bytes: Uint8Array) {
    this.parts.push(bytes.slice())
  }
  get bytes(): Bytes {
    return concat(...this.parts)
  }
}

async function* chunksOf(...parts: Uint8Array[]) {
  yield* parts
}

interface Parsed {
  name: string
  data: Uint8Array
  crcOk: boolean
  mtime: number
  directory: boolean
  mode: number
}

/** An independent, minimal reader: central directory first, as real tools do. */
function readZip(zip: Uint8Array): Parsed[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const u16 = (o: number) => view.getUint16(o, true)
  const u32 = (o: number) => view.getUint32(o, true)
  const u64 = (o: number) => Number(view.getBigUint64(o, true))

  let eocd = zip.length - 22
  while (u32(eocd) !== 0x06054b50) eocd--
  let count = u16(eocd + 10)
  let cdOffset = u32(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff || (eocd >= 20 && u32(eocd - 20) === 0x07064b50)) {
    const record = u64(eocd - 20 + 8)
    expect(u32(record)).toBe(0x06064b50)
    count = u64(record + 32)
    cdOffset = u64(record + 48)
  }

  const out: Parsed[] = []
  let at = cdOffset
  for (let i = 0; i < count; i++) {
    expect(u32(at)).toBe(0x02014b50)
    const crc = u32(at + 16)
    let size = u32(at + 24)
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    let offset = u32(at + 42)
    const mode = u32(at + 38) >>> 16
    const name = fromUtf8(zip.subarray(at + 46, at + 46 + nameLength))
    let mtime = 0
    for (let e = at + 46 + nameLength; e < at + 46 + nameLength + extraLength; ) {
      const id = u16(e)
      const length = u16(e + 2)
      if (id === 0x0001) {
        let field = e + 4
        if (size === 0xffffffff) {
          size = u64(field)
          field += 16
        }
        if (offset === 0xffffffff) offset = u64(field)
      } else if (id === 0x5455) {
        mtime = u32(e + 5) * 1000
      }
      e += 4 + length
    }
    expect(u32(offset)).toBe(0x04034b50)
    const dataStart = offset + 30 + u16(offset + 26) + u16(offset + 28)
    const data = zip.subarray(dataStart, dataStart + size)
    out.push({ name, data, crcOk: crc32(data) === crc, mtime, directory: name.endsWith('/'), mode })
    at += 46 + nameLength + extraLength + u16(at + 32)
  }
  return out
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
  })

  it('can be computed in pieces', () => {
    expect(crc32(utf8('6789'), crc32(utf8('12345')))).toBe(0xcbf43926)
  })
})

describe('ZipWriter', () => {
  const MTIME = Date.UTC(2026, 10, 11, 14, 5, 7)

  it.each([
    ['plain', false],
    ['ZIP64', true],
  ])('writes an archive a reader accepts (%s)', async (_name, zip64) => {
    const sink = new MemorySink()
    const zip = new ZipWriter(sink, zip64)
    await zip.addDirectory('Documents', MTIME)
    await zip.addFile('Documents/notes.txt', MTIME, 11, chunksOf(utf8('hello '), utf8('world')))
    await zip.addFile('Documents/empty.txt', MTIME, 0, chunksOf())
    await zip.addFile('Documents/café ☕.bin', MTIME, 5000, chunksOf(noise(3000, 1), noise(2000, 2)))
    await zip.addDirectory('Documents/Empty folder', MTIME)
    await zip.finish()
    expect(zip.size).toBe(sink.bytes.length)

    const entries = readZip(sink.bytes)
    expect(entries.map((e) => e.name)).toEqual([
      'Documents/',
      'Documents/notes.txt',
      'Documents/empty.txt',
      'Documents/café ☕.bin',
      'Documents/Empty folder/',
    ])
    expect(entries.every((e) => e.crcOk)).toBe(true)
    expect(fromUtf8(entries[1].data)).toBe('hello world')
    expect(entries[2].data.length).toBe(0)
    expect(entries[3].data).toEqual(concat(noise(3000, 1), noise(2000, 2)))
    expect(entries[1].mtime).toBe(Math.floor(MTIME / 1000) * 1000)
    expect(entries[0].mode).toBe(0o040755)
    expect(entries[1].mode).toBe(0o100644)
  })

  it('writes a valid empty archive', async () => {
    const sink = new MemorySink()
    await new ZipWriter(sink).finish()
    expect(sink.bytes.length).toBe(22)
    expect(readZip(sink.bytes)).toEqual([])
  })
})

describe('restore into a ZIP', () => {
  it('holds exactly what was backed up, with original dates, even though files restore in parallel', async () => {
    const dest = new MemoryDestination()
    const { repo } = await Repository.create(dest, 'correct horse', {
      packSize: 4096,
      argon2: { memoryKiB: 64, iterations: 1, parallelism: 1 },
    })
    const tree = new FakeDir('Documents', [
      new FakeFile('a.bin', noise(9000, 1), 1_700_000_000_000),
      new FakeFile('b.txt', utf8('bee'), 1_710_000_000_000),
      new FakeFile('..', utf8('sneaky')),
      new FakeDir('Photos', [new FakeFile('c.jpg', noise(5000, 3), 1_720_000_000_000), new FakeDir('Empty')]),
    ])
    const snapshot = await backup(repo, [{ name: 'Documents', handle: tree }], { device: 't', chunkSize: 1024 })

    const sink = new MemorySink()
    const zip = new ZipWriter(sink)
    const done = await restoreEntries(
      repo,
      snapshot.roots.map((r) => ({ name: r.name, type: 'dir', subtree: r.tree })),
      ZipTarget.root(zip),
    )
    await zip.finish()
    expect(done.files).toBe(4)

    const entries = readZip(sink.bytes)
    expect(entries.every((e) => e.crcOk)).toBe(true)
    const files = new Map(entries.filter((e) => !e.directory).map((e) => [e.name, e]))
    expect([...files.keys()].sort()).toEqual(['Documents/Photos/c.jpg', 'Documents/_', 'Documents/a.bin', 'Documents/b.txt'])
    expect(files.get('Documents/a.bin')!.data).toEqual(noise(9000, 1))
    expect(files.get('Documents/a.bin')!.mtime).toBe(1_700_000_000_000)
    expect(files.get('Documents/Photos/c.jpg')!.data).toEqual(noise(5000, 3))
    expect(files.get('Documents/Photos/c.jpg')!.mtime).toBe(1_720_000_000_000)
    expect(entries.filter((e) => e.directory).map((e) => e.name)).toEqual(['Documents/', 'Documents/Photos/', 'Documents/Photos/Empty/'])
  })
})
