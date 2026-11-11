import { describe, expect, it } from 'vitest'
import { fromHex, sha256Hex, utf8 } from './bytes'
import { AuthenticationError, blobId, deriveRepoKeys, FormatError, SEAL_OVERHEAD } from './crypto'
import { ENCODING_DEFLATE, ENCODING_RAW, PackWriter, readBlob, readPackHeader } from './pack'

const MASTER = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const keysFor = (repo = '00112233445566778899aabbccddeeff') => deriveRepoKeys(MASTER, repo)

const slice = (pack: Uint8Array, e: { offset: number; length: number }) => pack.subarray(e.offset, e.offset + e.length)

describe('pack', () => {
  it('stores blobs and reads them back by range', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    const a = await writer.add('data', utf8('first blob'))
    const b = await writer.add('data', new Uint8Array(100_000).fill(7))
    const pack = await writer.finish()

    expect(a.offset).toBe(4)
    expect(a.length).toBe(10 + SEAL_OVERHEAD)
    expect(b.offset).toBe(a.offset + a.length)
    expect(a.encoding).toBe(ENCODING_RAW)
    expect(a.id).toBe(await blobId(keys, utf8('first blob')))
    expect(pack.name).toBe(await sha256Hex(pack.bytes))

    expect(await readBlob(keys, a, slice(pack.bytes, a))).toEqual(utf8('first blob'))
    expect(await readBlob(keys, b, slice(pack.bytes, b))).toEqual(new Uint8Array(100_000).fill(7))
  })

  it('compresses tree blobs', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    const tree = utf8(JSON.stringify({ entries: Array.from({ length: 200 }, (_, i) => ({ name: `file-${i}.txt` })) }))
    const entry = await writer.add('tree', tree)
    const pack = await writer.finish()
    expect(entry.encoding).toBe(ENCODING_DEFLATE)
    expect(entry.length).toBeLessThan(tree.length / 2)
    expect(entry.rawLength).toBe(tree.length)
    expect(await readBlob(keys, entry, slice(pack.bytes, entry))).toEqual(tree)
  })

  it('recovers the blob list from the pack alone', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    await writer.add('data', utf8('one'))
    await writer.add('tree', utf8('{"entries":[]}'))
    const pack = await writer.finish()
    expect(await readPackHeader(keys, pack.bytes)).toEqual(pack.blobs)
  })

  it('handles an empty blob and an empty pack', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    const empty = await writer.add('data', new Uint8Array(0))
    const pack = await writer.finish()
    expect(await readBlob(keys, empty, slice(pack.bytes, empty))).toEqual(new Uint8Array(0))
    expect(await readPackHeader(keys, (await new PackWriter(keys).finish()).bytes)).toEqual([])
  })

  it('refuses a blob that was swapped, retyped, corrupted or truncated', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    const a = await writer.add('data', utf8('aaaa'))
    const b = await writer.add('data', utf8('bbbb'))
    const pack = await writer.finish()

    // b's bytes presented as a
    await expect(readBlob(keys, a, slice(pack.bytes, b))).rejects.toThrow(AuthenticationError)
    // right bytes, wrong declared type
    await expect(readBlob(keys, { ...a, type: 'tree' }, slice(pack.bytes, a))).rejects.toThrow(AuthenticationError)
    const corrupt = slice(pack.bytes, a).slice()
    corrupt[14] ^= 0x80
    await expect(readBlob(keys, a, corrupt)).rejects.toThrow(AuthenticationError)
    await expect(readBlob(keys, a, slice(pack.bytes, a).subarray(1))).rejects.toThrow(AuthenticationError)
  })

  it('refuses a blob written under an id that is not its own', async () => {
    const keys = await keysFor()
    const writer = new PackWriter(keys)
    const forged = await writer.add('data', utf8('evil'), await blobId(keys, utf8('good')))
    const pack = await writer.finish()
    await expect(readBlob(keys, forged, slice(pack.bytes, forged))).rejects.toThrow('does not match its id')
  })

  it('refuses a pack from another repository and a file that is not a pack', async () => {
    const writer = new PackWriter(await keysFor())
    await writer.add('data', utf8('x'))
    const pack = await writer.finish()
    const other = await keysFor('ffffffffffffffffffffffffffffffff')
    await expect(readPackHeader(other, pack.bytes)).rejects.toThrow(AuthenticationError)
    await expect(readPackHeader(other, utf8('not a pack at all'))).rejects.toThrow(FormatError)
    const badLength = pack.bytes.slice()
    badLength.set([255, 255, 255, 127], badLength.length - 4)
    await expect(readPackHeader(await keysFor(), badLength)).rejects.toThrow(FormatError)
  })
})
