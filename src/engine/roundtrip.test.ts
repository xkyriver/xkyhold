import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDestination } from '../storage/memory'
import { backup, FileReadError } from './backup'
import { utf8 } from './bytes'
import { AuthenticationError, WrongKeyError } from './crypto'
import { MissingBlobError, Repository } from './repo'
import type { Snapshot } from './repo'
import { restoreEntries } from './restore'
import { FakeDir, FakeFile, MemoryTarget, noise } from './testing'

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 }
// Small sizes so a few kilobytes exercise many chunks and packs.
const SIZES = { packSize: 4096, indexEvery: 2, argon2: FAST }
const CHUNK = 1024
const PASSWORD = 'correct horse'

function sampleTree(): FakeDir {
  return new FakeDir('Documents', [
    new FakeFile('notes.txt', utf8('hello world')),
    new FakeFile('empty.txt', new Uint8Array(0)),
    new FakeFile('big.bin', noise(10_000, 1)),
    new FakeFile('exact.bin', noise(CHUNK * 2, 2)),
    new FakeDir('Photos', [new FakeFile('a.jpg', noise(3000, 3)), new FakeDir('2026', [new FakeFile('b.jpg', noise(500, 4))])]),
    new FakeDir('Empty folder'),
    new FakeFile('café ☕.txt', utf8('unicode name')),
  ])
}

async function restoreAll(repo: Repository, snapshot: Snapshot): Promise<MemoryTarget> {
  const target = new MemoryTarget()
  for (const root of snapshot.roots) {
    await restoreEntries(repo, await repo.loadTree(root.tree), await target.createDir(root.name))
  }
  return target
}

const prefixed = (dir: FakeDir) => new Map([...dir.flatten()].map(([k, v]) => [`${dir.name}/${k}`, v]))

let dest: MemoryDestination
let repo: Repository
let tree: FakeDir
const run = (parent?: Snapshot | null, r = repo) =>
  backup(r, [{ name: tree.name, handle: tree }], { device: 'test', parent, chunkSize: CHUNK })

beforeEach(async () => {
  dest = new MemoryDestination()
  ;({ repo } = await Repository.create(dest, PASSWORD, SIZES))
  tree = sampleTree()
})

describe('backup and restore', () => {
  it('restores exactly what was backed up, from a freshly opened repository', async () => {
    const snapshot = await run()
    expect(snapshot.stats).toEqual({ files: 7, bytes: 11 + 10_000 + 2048 + 3000 + 500 + 12, skipped: 0 })

    const reopened = await Repository.open(dest, { password: PASSWORD }, SIZES)
    const [listed] = await reopened.listSnapshots()
    expect(listed).toEqual(snapshot)
    const restored = await restoreAll(reopened, listed)
    expect(restored.flatten()).toEqual(prefixed(tree))
    expect(restored.mtimes.get('Documents/notes.txt')).toBe(1_794_400_000_000)
  })

  it('opens with the recovery key too, and not with a wrong password', async () => {
    const fresh = new MemoryDestination()
    const created = await Repository.create(fresh, PASSWORD, SIZES)
    const snapshot = await backup(created.repo, [{ name: tree.name, handle: tree }], { device: 't', chunkSize: CHUNK })
    const byRecovery = await Repository.open(fresh, { recoveryKey: created.recoveryKey }, SIZES)
    expect((await restoreAll(byRecovery, snapshot)).flatten()).toEqual(prefixed(tree))
    await expect(Repository.open(fresh, { password: 'nope' })).rejects.toThrow(WrongKeyError)
  })

  it('keeps working after a password change', async () => {
    const snapshot = await run()
    await Repository.changePassword(dest, { password: PASSWORD }, 'new password', FAST)
    await expect(Repository.open(dest, { password: PASSWORD })).rejects.toThrow(WrongKeyError)
    const reopened = await Repository.open(dest, { password: 'new password' }, SIZES)
    expect((await restoreAll(reopened, snapshot)).flatten()).toEqual(prefixed(tree))
  })

  it('stores nothing readable: no file name or content appears in the destination', async () => {
    await run()
    const all = [...dest.objects.entries()].filter(([k]) => k !== '/config')
    const haystack = all.map(([k, v]) => k + Array.from(v, (b) => String.fromCharCode(b)).join('')).join('\n')
    for (const needle of ['notes.txt', 'hello world', 'Photos', 'Documents', 'a.jpg']) {
      expect(haystack).not.toContain(needle)
    }
  })

  it('names every pack and index after its SHA-256', async () => {
    await run()
    for (const dir of ['packs', 'index'] as const) {
      const objects = await dest.list(dir)
      expect(objects.length).toBeGreaterThan(0)
      for (const o of objects) expect(o.name).toBe(o.sha256)
    }
  })
})

describe('incremental backups', () => {
  it('uploads nothing and reads no file when nothing changed', async () => {
    const first = await run()
    const packs = dest.names('packs').length
    const readsBefore = tree.file('big.bin').reads
    const uploaded = repo.uploadedBytes

    const progress: number[] = []
    const second = await backup(repo, [{ name: tree.name, handle: tree }], {
      device: 'test',
      parent: first,
      chunkSize: CHUNK,
      onProgress: (p) => progress.push(p.filesRead),
    })
    expect(dest.names('packs').length).toBe(packs)
    expect(repo.uploadedBytes).toBe(uploaded)
    expect(tree.file('big.bin').reads).toBe(readsBefore)
    expect(Math.max(...progress)).toBe(0)
    expect(second.parent).toBe(first.id)
    expect(second.roots).toEqual(first.roots)
    expect(second.stats).toEqual(first.stats)
  })

  it('uploads only the changed chunk of a modified file', async () => {
    const first = await run()
    const big = tree.file('big.bin')
    big.data = big.data.slice()
    big.data[5000] ^= 0xff // inside the 5th chunk
    big.mtime += 1000
    const uploaded = repo.uploadedBytes

    const second = await run(first)
    // one 1 KiB data chunk plus the changed folder listings, not the 10 KB file
    expect(repo.uploadedBytes - uploaded).toBeLessThan(2500)
    expect((await restoreAll(repo, second)).flatten()).toEqual(prefixed(tree))
    // the first snapshot still restores the old content
    expect((await restoreAll(repo, first)).files.get('Documents/big.bin')).toEqual(noise(10_000, 1))
  })

  it('re-reads a file whose size is unchanged but whose time moved', async () => {
    const first = await run()
    const notes = tree.file('notes.txt')
    notes.data = utf8('HELLO WORLD')
    notes.mtime += 1
    const second = await run(first)
    expect((await restoreAll(repo, second)).files.get('Documents/notes.txt')).toEqual(utf8('HELLO WORLD'))
  })

  it('stores identical content once, across files and folders', async () => {
    await run()
    const blobs = repo.blobCount
    const packs = dest.names('packs').length
    tree.children.push(new FakeFile('copy of big.bin', noise(10_000, 1)))
    const second = await run()
    expect(repo.blobCount).toBe(blobs + 1) // only the new root listing
    expect(dest.names('packs').length).toBe(packs + 1)
    expect((await restoreAll(repo, second)).flatten()).toEqual(prefixed(tree))
  })

  it('tracks added, removed and renamed entries', async () => {
    const first = await run()
    tree.children = tree.children.filter((c) => c.name !== 'notes.txt')
    tree.file('Photos/a.jpg').name = 'renamed.jpg'
    ;(tree.children.find((c) => c.name === 'Empty folder') as FakeDir).children.push(new FakeFile('new.txt', utf8('new')))
    const second = await run(first)
    expect((await restoreAll(repo, second)).flatten()).toEqual(prefixed(tree))
  })

  it('still backs up correctly with a parent from an unrelated tree', async () => {
    const first = await run()
    tree = new FakeDir('Documents', [new FakeFile('notes.txt', utf8('different!!'), 1_794_500_000_000), new FakeDir('Photos', [])])
    const second = await run(first)
    expect((await restoreAll(repo, second)).flatten()).toEqual(prefixed(tree))
  })
})

describe('failures', () => {
  it('skips unreadable files and folders, and says so', async () => {
    tree.file('notes.txt').unreadable = true
    ;(tree.children.find((c) => c.name === 'Photos') as FakeDir).unreadable = true
    const snapshot = await run()
    expect(snapshot.stats.skipped).toBe(2)
    const restored = (await restoreAll(repo, snapshot)).flatten()
    expect(restored.has('Documents/notes.txt')).toBe(false)
    expect([...restored.keys()].some((k) => k.startsWith('Documents/Photos'))).toBe(false)
    expect(restored.get('Documents/big.bin')).toEqual(noise(10_000, 1))
  })

  it('fails, rather than skipping, when the chosen folder itself cannot be read', async () => {
    tree.unreadable = true
    await expect(run()).rejects.toThrow(FileReadError)
    expect(dest.names('snapshots')).toEqual([])
  })

  it('writes no snapshot when the upload fails, and a retry completes the backup', async () => {
    dest.failPutsFrom = dest.puts + 3
    await expect(run()).rejects.toThrow('network down')
    expect(dest.names('snapshots')).toEqual([])

    dest.failPutsFrom = null
    const snapshot = await run() // same Repository instance, as after a "Try again"
    expect((await restoreAll(repo, snapshot)).flatten()).toEqual(prefixed(tree))
    const reopened = await Repository.open(dest, { password: PASSWORD }, SIZES)
    expect((await restoreAll(reopened, snapshot)).flatten()).toEqual(prefixed(tree))
  })

  it('does not re-upload checkpointed data after an interrupted backup', async () => {
    dest.failPutsFrom = dest.puts + 8 // late enough for at least one index checkpoint
    await expect(run()).rejects.toThrow('network down')
    expect(dest.names('index').length).toBeGreaterThan(0)
    dest.failPutsFrom = null

    const resumed = await Repository.open(dest, { password: PASSWORD }, SIZES) // as after a browser restart
    const known = resumed.blobCount
    expect(known).toBeGreaterThan(0)
    const snapshot = await run(null, resumed)
    expect((await restoreAll(resumed, snapshot)).flatten()).toEqual(prefixed(tree))

    const full = new MemoryDestination()
    const clean = (await Repository.create(full, PASSWORD, SIZES)).repo
    await run(null, clean)
    expect(resumed.uploadedBytes).toBeLessThan(clean.uploadedBytes)
  })

  it('stops when aborted and leaves no snapshot', async () => {
    const controller = new AbortController()
    const attempt = backup(repo, [{ name: tree.name, handle: tree }], {
      device: 'test',
      chunkSize: CHUNK,
      signal: controller.signal,
      onProgress: (p) => p.files === 2 && controller.abort(),
    })
    await expect(attempt).rejects.toThrow()
    expect(dest.names('snapshots')).toEqual([])
  })

  it('refuses to restore a corrupted pack', async () => {
    const snapshot = await run()
    for (const [key, bytes] of dest.objects) {
      if (key.startsWith('packs/')) bytes[bytes.length >> 1] ^= 1
    }
    await expect(restoreAll(repo, snapshot)).rejects.toThrow(AuthenticationError)
  })

  it('reports missing data when a pack is gone', async () => {
    const snapshot = await run()
    for (const name of dest.names('packs')) await dest.trash('packs', name)
    await expect(restoreAll(repo, snapshot)).rejects.toThrow(MissingBlobError)
  })

  it('refuses a snapshot stored under another id', async () => {
    const snapshot = await run()
    const bytes = await dest.get('snapshots', snapshot.id)
    await dest.put('snapshots', 'ffffffffffffffffffffffffffffffff', bytes)
    await expect(repo.loadSnapshot('ffffffffffffffffffffffffffffffff')).rejects.toThrow(AuthenticationError)
  })
})
