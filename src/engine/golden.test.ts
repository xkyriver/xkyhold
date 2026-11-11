// Compatibility with data written by earlier versions. golden-v1.json was
// generated once and must never be regenerated: if this test fails, the
// change under test would make existing backups unreadable.

import { describe, expect, it } from 'vitest'
import { fromBase64, fromUtf8, sha256Hex, utf8 } from './bytes'
import { blobId, unlockRepository } from './crypto'
import golden from './golden-v1.json'
import { readBlob, readPackHeader } from './pack'
import type { BlobEntry } from './pack'
import type { RepoConfig } from './crypto'

const config = golden.config as RepoConfig
const pack = fromBase64(golden.pack.base64)

describe('format v1 golden fixture', () => {
  it.each([
    ['password', { password: golden.password }],
    ['recovery key', { recoveryKey: golden.recoveryKey }],
  ])('opens with the %s and derives the same blob ids', async (_name, credential) => {
    const keys = await unlockRepository(config, credential)
    expect(await blobId(keys, utf8('abc'))).toBe(golden.blobIdOfAbc)
  })

  it('reads the stored pack', async () => {
    const keys = await unlockRepository(config, { password: golden.password })
    expect(await sha256Hex(pack)).toBe(golden.pack.name)
    const blobs = await readPackHeader(keys, pack)
    expect(blobs).toEqual(golden.pack.blobs)
    const [data, tree] = blobs as BlobEntry[]
    const read = async (e: BlobEntry) => fromUtf8(await readBlob(keys, e, pack.subarray(e.offset, e.offset + e.length)))
    expect(await read(data)).toBe('The quick brown fox jumps over the lazy dog')
    expect(JSON.parse(await read(tree)).entries[0].name).toBe('fox.txt')
  })
})
