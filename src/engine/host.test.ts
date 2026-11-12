import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDestination } from '../storage/memory'
import { utf8 } from './bytes'
import { EngineClient } from './client'
import { EngineError } from './errors'
import { createHost } from './host'
import type { Request, Response } from './host'
import type { TreeDir, TreeEntry } from './repo'
import { FakeDir, FakeFile, noise } from './testing'

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 }

/** A page and an engine in one thread, talking only through messages. */
function connect() {
  const destinations = new Map<string, MemoryDestination>()
  const clock = { now: new Date('2026-11-12T10:00:00Z') }
  const zips = { discarded: 0 }
  let toClient: (message: Response) => void = () => {}
  const handle = createHost(
    {
      destination: async (name, token) => {
        await token() // every storage access needs a session, as with Drive
        let dest = destinations.get(name)
        if (!dest) destinations.set(name, (dest = new MemoryDestination()))
        return dest
      },
      listBackups: async (token) => {
        await token()
        return [...destinations.keys()].sort()
      },
      openZip: async () => {
        const parts: Uint8Array[] = []
        return {
          write: (bytes) => void parts.push(bytes.slice()),
          finish: async () => ({ blob: new Blob(parts as BlobPart[]) }),
          discard: async () => void zips.discarded++,
        }
      },
      repository: { packSize: 4096, indexEvery: 2, argon2: FAST },
      now: () => clock.now,
    },
    (message) => queueMicrotask(() => toClient(message)),
  )
  const client = new EngineClient({
    post: (message: Request) => queueMicrotask(() => handle(message)),
    listen: (onMessage) => (toClient = onMessage),
  })
  return { client, destinations, clock, zips }
}

const tree = () =>
  new FakeDir('Documents', [
    new FakeFile('notes.txt', utf8('hello world')),
    new FakeFile('big.bin', noise(20_000, 1)),
    new FakeDir('Photos', [new FakeFile('a.jpg', noise(3000, 3))]),
  ])

const roots = (dir: FakeDir) => [{ name: dir.name, handle: dir }]
const asDirs = (snapshot: { roots: { name: string; tree: string }[] }): TreeEntry[] =>
  snapshot.roots.map((r) => ({ name: r.name, type: 'dir', subtree: r.tree }))

let page: ReturnType<typeof connect>
beforeEach(() => {
  page = connect()
  page.client.setToken('token')
})

describe('engine over messages', () => {
  it('creates a backup, backs up with progress, and checks it', async () => {
    const { client } = page
    const created = await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    expect(created.recoveryKey).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/)

    const seen: number[] = []
    const { snapshot, sentBytes } = await client.call(
      'backup',
      { roots: roots(tree()), device: 'laptop', keepMonths: 0 },
      { onProgress: (p) => seen.push(p.files) },
    )
    expect(snapshot.stats).toEqual({ files: 3, bytes: 23_011, skipped: 0 })
    expect(sentBytes).toBeGreaterThan(23_000)
    expect(seen.at(-1)).toBe(3)

    expect(await client.call('check', { entries: asDirs(snapshot) })).toEqual({ files: 3, bytes: 23_011 })
    expect(await client.call('listBackups', undefined)).toEqual(['laptop'])
  })

  it('makes the second backup incremental, using the history it keeps', async () => {
    const { client } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const files = tree()
    const first = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 0 })
    const second = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 0 })
    expect(second.sentBytes).toBe(0)
    expect(second.snapshot.parent).toBe(first.snapshot.id)
  })

  it('reconnects from another device with the password or the recovery key, then reopens with the keys', async () => {
    const { client } = page
    const { recoveryKey } = await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const { snapshot } = await client.call('backup', { roots: roots(tree()), device: 'laptop', keepMonths: 0 })
    await client.call('close', undefined)

    const byPassword = await client.call('connect', { repoName: 'laptop', credential: { password: 'correct horse' } })
    expect(byPassword.snapshots).toEqual([snapshot])
    const byKey = await client.call('connect', { repoName: 'laptop', credential: { recoveryKey } })
    await client.call('close', undefined)

    const reopened = await client.call('open', { repoName: 'laptop', keys: byKey.keys })
    expect(reopened.snapshots).toEqual([snapshot])
    const top = await client.call('loadTree', { tree: snapshot.roots[0].tree })
    expect(top.map((e) => e.name)).toEqual(['Photos', 'big.bin', 'notes.txt'])
    const photos = top.find((e): e is TreeDir => e.type === 'dir')!
    expect((await client.call('loadTree', { tree: photos.subtree })).map((e) => e.name)).toEqual(['a.jpg'])
  })

  it('restores into a ZIP archive, and discards it when the restore fails', async () => {
    const { client, destinations, zips } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const { snapshot } = await client.call('backup', { roots: roots(tree()), device: 'laptop', keepMonths: 0 })

    const done = await client.call('restoreZip', { entries: asDirs(snapshot) })
    expect(done).toMatchObject({ files: 3, bytes: 23_011 })
    const archive = new Uint8Array(await done.blob!.arrayBuffer())
    expect(archive.length).toBeGreaterThan(23_011)
    expect(new TextDecoder().decode(archive.subarray(0, 2))).toBe('PK')
    expect(zips.discarded).toBe(0)

    const dest = destinations.get('laptop')!
    for (const name of dest.names('packs')) await dest.trash('packs', name)
    await expect(client.call('restoreZip', { entries: asDirs(snapshot) })).rejects.toMatchObject({ kind: 'damaged' })
    expect(zips.discarded).toBe(1)
  })

  it('changes the password', async () => {
    const { client } = page
    await client.call('create', { repoName: 'laptop', password: 'old password' })
    await client.call('changePassword', { repoName: 'laptop', credential: { password: 'old password' }, newPassword: 'new password' })
    await expect(client.call('connect', { repoName: 'laptop', credential: { password: 'old password' } })).rejects.toMatchObject({
      kind: 'wrong-key',
    })
    await expect(client.call('connect', { repoName: 'laptop', credential: { password: 'new password' } })).resolves.toBeDefined()
  })

  it('reports failures by kind, as EngineError', async () => {
    const { client, destinations } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })

    const again = client.call('create', { repoName: 'laptop', password: 'x' })
    await expect(again).rejects.toBeInstanceOf(EngineError)
    await expect(again).rejects.toMatchObject({ kind: 'exists' })

    const { snapshot } = await client.call('backup', { roots: roots(tree()), device: 'laptop', keepMonths: 0 })
    const dest = destinations.get('laptop')!
    dest.failPutsFrom = dest.puts + 1
    const changed = tree()
    changed.file('notes.txt').data = utf8('changed!!!!')
    changed.file('notes.txt').mtime += 1
    await expect(client.call('backup', { roots: roots(changed), device: 'laptop', keepMonths: 0 })).rejects.toMatchObject({ kind: 'network' })
    dest.failPutsFrom = null

    for (const name of dest.names('packs')) await dest.trash('packs', name)
    await expect(client.call('check', { entries: asDirs(snapshot) })).rejects.toMatchObject({ kind: 'damaged' })

    const unreadable = tree()
    unreadable.unreadable = true
    await expect(client.call('backup', { roots: roots(unreadable), device: 'laptop', keepMonths: 0 })).rejects.toMatchObject({ kind: 'read' })
  })

  it('refuses to work without a Google session', async () => {
    const { client } = page
    client.setToken(null)
    await expect(client.call('listBackups', undefined)).rejects.toMatchObject({ kind: 'session' })
    client.setToken('token')
    await expect(client.call('listBackups', undefined)).resolves.toEqual([])
  })

  it('needs an open backup for backup and restore', async () => {
    await expect(page.client.call('loadTree', { tree: 'x' })).rejects.toMatchObject({ kind: 'other' })
  })

  it('removes old backups after a new one, when asked to keep only some months', async () => {
    const { client, destinations } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const files = tree()

    page.clock.now = new Date('2026-01-10T10:00:00Z')
    const january = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 3 })
    expect(january.removed).toBe(0)

    files.children = files.children.filter((c) => c.name !== 'big.bin')
    page.clock.now = new Date('2026-11-12T10:00:00Z')
    const november = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 3 })
    expect(november.removed).toBe(1)
    expect(november.freedBytes).toBeGreaterThan(20_000)
    expect(november.snapshots.map((s) => s.id)).toEqual([november.snapshot.id])
    expect(destinations.get('laptop')!.names('locks')).toEqual([])
    expect(await client.call('check', { entries: asDirs(november.snapshot) })).toEqual({ files: 2, bytes: 3011 })

    // "Forever" keeps everything.
    page.clock.now = new Date('2030-01-01T10:00:00Z')
    const later = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 0 })
    expect(later.removed).toBe(0)
    expect(later.snapshots).toHaveLength(2)
  })

  it('still reports a good backup when tidying up cannot run', async () => {
    const { client, destinations } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const files = tree()
    page.clock.now = new Date('2026-01-10T10:00:00Z')
    await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 3 })

    // Another device holds a fresh backup lock, so prune must give way.
    page.clock.now = new Date('2026-11-12T10:00:00Z')
    const dest = destinations.get('laptop')!
    await dest.put('locks', 'other', utf8(JSON.stringify({ kind: 'backup', device: 'desktop', time: new Date().toISOString() })))
    const result = await client.call('backup', { roots: roots(files), device: 'laptop', keepMonths: 3 })
    expect(result.removed).toBe(0)
    expect(result.snapshots).toHaveLength(2)
  })

  it('refuses to back up while another device is tidying the backup', async () => {
    const { client, destinations } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    const dest = destinations.get('laptop')!
    await dest.put('locks', 'other', utf8(JSON.stringify({ kind: 'prune', device: 'desktop', time: new Date().toISOString() })))
    await expect(client.call('backup', { roots: roots(tree()), device: 'laptop', keepMonths: 0 })).rejects.toMatchObject({ kind: 'busy' })
    expect(dest.names('snapshots')).toEqual([])
  })

  it('stops a running backup when asked, and leaves no snapshot', async () => {
    const { client, destinations } = page
    await client.call('create', { repoName: 'laptop', password: 'correct horse' })
    destinations.get('laptop')!.putDelayMs = 5
    const controller = new AbortController()
    const running = client.call(
      'backup',
      { roots: roots(tree()), device: 'laptop', keepMonths: 0 },
      { signal: controller.signal, onProgress: () => controller.abort() },
    )
    await expect(running).rejects.toMatchObject({ kind: 'aborted' })
    expect(destinations.get('laptop')!.names('snapshots')).toEqual([])

    // The engine is still usable afterwards.
    destinations.get('laptop')!.putDelayMs = 0
    const { snapshot } = await client.call('backup', { roots: roots(tree()), device: 'laptop', keepMonths: 0 })
    expect(snapshot.stats.files).toBe(3)
  })
})
