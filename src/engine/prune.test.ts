import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDestination } from '../storage/memory'
import { backup } from './backup'
import { utf8 } from './bytes'
import { Lock, STALE_AFTER_MS } from './lock'
import { expired, forget, prune } from './prune'
import { Repository } from './repo'
import type { Snapshot } from './repo'
import { restoreEntries } from './restore'
import { FakeDir, FakeFile, MemoryTarget, noise } from './testing'

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 }
const SIZES = { packSize: 4096, indexEvery: 2, argon2: FAST }
const CHUNK = 1024
const PASSWORD = 'correct horse'

let dest: MemoryDestination
let repo: Repository
let tree: FakeDir

const at = (iso: string) => () => new Date(iso)
const run = (when: string, parent: Snapshot | null = null, r = repo) =>
  backup(r, [{ name: tree.name, handle: tree }], { device: 'test', parent, chunkSize: CHUNK, now: at(when) })

async function restored(r: Repository, snapshot: Snapshot): Promise<Map<string, Uint8Array | null>> {
  const target = new MemoryTarget()
  for (const root of snapshot.roots) await restoreEntries(r, await r.loadTree(root.tree), await target.createDir(root.name))
  return target.flatten()
}

const reopen = () => Repository.open(dest, { password: PASSWORD }, SIZES)

beforeEach(async () => {
  dest = new MemoryDestination()
  ;({ repo } = await Repository.create(dest, PASSWORD, SIZES))
  tree = new FakeDir('Documents', [
    new FakeFile('keep.bin', noise(6000, 1)),
    new FakeFile('old.bin', noise(9000, 2)),
    new FakeFile('small-a.txt', utf8('a'.repeat(300))),
    new FakeFile('small-b.txt', utf8('b'.repeat(300))),
  ])
})

/** Three snapshots: old.bin and small-b.txt disappear after the first. */
async function history() {
  const first = await run('2026-01-10T10:00:00Z')
  const firstView = await restored(repo, first)
  tree.children = tree.children.filter((c) => c.name !== 'old.bin' && c.name !== 'small-b.txt')
  const second = await run('2026-06-10T10:00:00Z', first)
  tree.children.push(new FakeFile('new.bin', noise(5000, 3)))
  const third = await run('2026-11-10T10:00:00Z', second)
  return { first, second, third, firstView, secondView: await restored(repo, second), thirdView: await restored(repo, third) }
}

describe('expired', () => {
  const snap = (id: string, time: string) => ({ id, time }) as Snapshot
  const all = [snap('a', '2026-01-10T10:00:00Z'), snap('b', '2026-06-10T10:00:00Z'), snap('c', '2026-11-10T10:00:00Z')]
  const now = new Date('2026-11-12T12:00:00Z')

  it('keeps everything when retention is "forever"', () => {
    expect(expired(all, 0, now)).toEqual([])
  })

  it('removes what is older than the window', () => {
    expect(expired(all, 6, now).map((s) => s.id)).toEqual(['a'])
    expect(expired(all, 3, now).map((s) => s.id)).toEqual(['a', 'b'])
    expect(expired(all, 12, now)).toEqual([])
  })

  it('never removes the newest snapshot, however old', () => {
    expect(expired(all, 3, new Date('2030-01-01T00:00:00Z')).map((s) => s.id)).toEqual(['a', 'b'])
    expect(expired([all[0]], 3, new Date('2030-01-01T00:00:00Z'))).toEqual([])
  })
})

describe('forget and prune', () => {
  it('frees the data only old snapshots needed, and the rest still restores exactly', async () => {
    const h = await history()
    const packsBefore = dest.names('packs').length
    const { kept, removed } = await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
    expect(removed.map((s) => s.id)).toEqual([h.first.id])
    expect(kept.map((s) => s.id)).toEqual([h.second.id, h.third.id])

    const result = await prune(repo)
    expect(result.packsRemoved).toBeGreaterThan(0)
    expect(result.bytesFreed).toBeGreaterThan(9000) // old.bin is gone
    expect(dest.names('packs').length).toBeLessThan(packsBefore)
    expect(dest.names('index')).toHaveLength(1)

    for (const r of [repo, await reopen()]) {
      expect((await r.listSnapshots()).map((s) => s.id)).toEqual([h.second.id, h.third.id])
      expect(await restored(r, h.second)).toEqual(h.secondView)
      expect(await restored(r, h.third)).toEqual(h.thirdView)
    }
  })

  it('never deletes: everything it removes is in the trash', async () => {
    const h = await history()
    const all = new Map(dest.objects)
    await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
    await prune(repo)
    for (const key of all.keys()) expect(dest.objects.has(key) || dest.trashed.has(key), key).toBe(true)
    expect(dest.trashed.has(`snapshots/${h.first.id}`)).toBe(true)
  })

  it('rewrites a pack that is mostly dead and keeps its live blobs', async () => {
    const h = await history()
    await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
    // With a threshold of 1, any pack with a single dead blob is rewritten.
    const result = await prune(repo, { repackBelow: 1 })
    expect(result.packsRewritten).toBeGreaterThan(0)
    const fresh = await reopen()
    expect(await restored(fresh, h.third)).toEqual(h.thirdView)
    // Nothing dead is left: a second prune finds nothing to do.
    expect(await prune(fresh, { repackBelow: 1 })).toEqual({ packsRemoved: 0, packsRewritten: 0, bytesFreed: 0 })
  })

  it('does nothing when every snapshot is kept', async () => {
    await history()
    const before = new Map(dest.objects)
    expect(await prune(repo)).toEqual({ packsRemoved: 0, packsRewritten: 0, bytesFreed: 0 })
    expect(new Map(dest.objects)).toEqual(before)
  })

  it('removes packs left behind by a backup that never finished', async () => {
    const first = await run('2026-11-01T10:00:00Z')
    const view = await restored(repo, first)
    tree.children.push(new FakeFile('never-finished.bin', noise(20_000, 9)))
    dest.failPutsFrom = dest.puts + 3 // dies before any index checkpoint
    await expect(run('2026-11-02T10:00:00Z', first)).rejects.toThrow('network down')
    dest.failPutsFrom = null
    const fresh = await reopen()
    const orphans = dest.names('packs').length - fresh.packs().size
    expect(orphans).toBeGreaterThan(0)

    expect((await prune(fresh)).packsRemoved).toBe(orphans)
    expect(await restored(await reopen(), first)).toEqual(view)
  })

  it('sees a backup made by another device since it was opened', async () => {
    const h = await history()
    // Another device backs up a new file; `repo` knows nothing about it.
    const other = await reopen()
    tree.children.push(new FakeFile('from-elsewhere.bin', noise(7000, 5)))
    const theirs = await run('2026-11-11T10:00:00Z', h.third, other)
    const theirView = await restored(other, theirs)

    await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
    await prune(repo, { repackBelow: 1 })
    expect(await restored(await reopen(), theirs)).toEqual(theirView)
  })

  it('stops before removing anything when a folder listing cannot be read', async () => {
    const h = await history()
    await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
    // Damage every pack: no listing can be verified.
    for (const [key, bytes] of dest.objects) if (key.startsWith('packs/')) bytes[bytes.length >> 1] ^= 1
    const packs = dest.names('packs')
    await expect(prune(await reopen())).rejects.toThrow()
    expect(dest.names('packs')).toEqual(packs)
    expect(h.third.id).toBeTruthy()
  })

  it('leaves a restorable repository wherever it is interrupted', async () => {
    // Count the writes of a clean run, then fail at each one in turn.
    const count = async (fail?: { puts?: number; trashes?: number }) => {
      dest = new MemoryDestination()
      ;({ repo } = await Repository.create(dest, PASSWORD, SIZES))
      tree = new FakeDir('Documents', [
        new FakeFile('keep.bin', noise(6000, 1)),
        new FakeFile('old.bin', noise(9000, 2)),
        new FakeFile('small-a.txt', utf8('a'.repeat(300))),
        new FakeFile('small-b.txt', utf8('b'.repeat(300))),
      ])
      const h = await history()
      await forget(repo, await repo.listSnapshots(), 6, new Date('2026-11-12T12:00:00Z'))
      const puts = dest.puts
      const trashes = dest.trashes
      if (fail?.puts) dest.failPutsFrom = puts + fail.puts
      if (fail?.trashes) dest.failTrashesFrom = trashes + fail.trashes
      const outcome = await prune(repo, { repackBelow: 1 }).then(
        () => 'done',
        () => 'failed',
      )
      dest.failPutsFrom = dest.failTrashesFrom = null
      return { h, outcome, puts: dest.puts - puts, trashes: dest.trashes - trashes }
    }

    const clean = await count()
    expect(clean.outcome).toBe('done')
    expect(clean.puts).toBeGreaterThan(1)
    expect(clean.trashes).toBeGreaterThan(2)

    const points = [
      ...Array.from({ length: clean.puts }, (_, i) => ({ puts: i + 1 })),
      ...Array.from({ length: clean.trashes }, (_, i) => ({ trashes: i + 1 })),
    ]
    for (const point of points) {
      const { h, outcome } = await count(point)
      expect(outcome, JSON.stringify(point)).toBe('failed')
      const fresh = await reopen()
      expect(await restored(fresh, h.second), JSON.stringify(point)).toEqual(h.secondView)
      expect(await restored(fresh, h.third), JSON.stringify(point)).toEqual(h.thirdView)
      // And a later prune finishes the job.
      await prune(fresh, { repackBelow: 1 })
      expect(await restored(await reopen(), h.third), JSON.stringify(point)).toEqual(h.thirdView)
    }
  })
})

describe('locks', () => {
  const quiet = { every: () => () => {} }

  it('lets backups run together, and removes its lock when released', async () => {
    const a = await Lock.acquire(dest, 'backup', 'laptop', quiet)
    const b = await Lock.acquire(dest, 'backup', 'desktop', quiet)
    expect(dest.names('locks')).toHaveLength(2)
    await a.release()
    await b.release()
    expect(dest.names('locks')).toEqual([])
  })

  it('refuses to prune while a backup is running, and leaves no lock behind', async () => {
    const running = await Lock.acquire(dest, 'backup', 'laptop', quiet)
    await expect(Lock.acquire(dest, 'prune', 'desktop', quiet)).rejects.toMatchObject({ kind: 'busy' })
    expect(dest.names('locks')).toHaveLength(1)
    await running.release()
    await (await Lock.acquire(dest, 'prune', 'desktop', quiet)).release()
  })

  it('refuses to back up or prune while a prune is running', async () => {
    const pruning = await Lock.acquire(dest, 'prune', 'laptop', quiet)
    await expect(Lock.acquire(dest, 'backup', 'desktop', quiet)).rejects.toMatchObject({ kind: 'busy' })
    await expect(Lock.acquire(dest, 'prune', 'desktop', quiet)).rejects.toMatchObject({ kind: 'busy' })
    await pruning.release()
  })

  it('ignores a lock whose owner stopped refreshing it', async () => {
    let clock = Date.parse('2026-11-12T10:00:00Z')
    const now = () => clock
    await Lock.acquire(dest, 'backup', 'crashed laptop', { ...quiet, now }) // never released
    clock += STALE_AFTER_MS - 1000
    await expect(Lock.acquire(dest, 'prune', 'desktop', { ...quiet, now })).rejects.toMatchObject({ kind: 'busy' })
    clock += 2000
    await (await Lock.acquire(dest, 'prune', 'desktop', { ...quiet, now })).release()
    // A day later the dead lock is tidied away.
    clock += 25 * 60 * 60_000
    await (await Lock.acquire(dest, 'backup', 'desktop', { ...quiet, now })).release()
    expect(dest.names('locks')).toEqual([])
  })

  it('refreshes by writing a new lock and dropping the old one', async () => {
    let tick: () => void = () => {}
    const lock = await Lock.acquire(dest, 'backup', 'laptop', { every: (_ms, run) => ((tick = run), () => {}) })
    const [before] = dest.names('locks')
    tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const after = dest.names('locks')
    expect(after).toHaveLength(1)
    expect(after[0]).not.toBe(before)
    await lock.release()
    expect(dest.names('locks')).toEqual([])
  })
})
