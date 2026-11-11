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

// --- A whole repository ---------------------------------------------------

import { MemoryDestination } from '../storage/memory'
import goldenRepo from './golden-v1-repo.json'
import { Repository } from './repo'
import { restoreEntries } from './restore'
import { MemoryTarget, noise } from './testing'

describe('format v1 golden repository', () => {
  async function load(): Promise<MemoryDestination> {
    const dest = new MemoryDestination()
    for (const [key, value] of Object.entries(goldenRepo.objects)) dest.objects.set(key, fromBase64(value))
    return dest
  }

  it.each([
    ['password', { password: goldenRepo.password }],
    ['recovery key', { recoveryKey: goldenRepo.recoveryKey }],
  ])('restores every file with the %s', async (_name, credential) => {
    const repo = await Repository.open(await load(), credential)
    const snapshots = await repo.listSnapshots()
    expect(snapshots.map((s) => s.id)).toEqual([goldenRepo.snapshotId])
    const [snapshot] = snapshots
    expect(snapshot).toMatchObject({
      time: '2026-11-11T15:00:00.000Z',
      device: 'golden',
      parent: null,
      stats: { files: 4, bytes: 3711, skipped: 0 },
    })

    const target = new MemoryTarget()
    await restoreEntries(repo, await repo.loadTree(snapshot.roots[0].tree), await target.createDir('Documents'))
    expect(target.flatten()).toEqual(
      new Map<string, Uint8Array | null>([
        ['Documents/notes.txt', utf8('hello world')],
        ['Documents/empty.txt', new Uint8Array(0)],
        ['Documents/noise.bin', noise(3000, 7)],
        ['Documents/Photos/a.jpg', noise(700, 8)],
        ['Documents/Empty folder/', null],
      ]),
    )
  })
})
