import { describe, expect, it } from 'vitest'
import { utf8 } from '../engine/bytes'
import { NotFoundError } from './destination'
import { Drive, DRIVE_FOLDER_MIME } from './drive'
import { APP_FOLDER, DriveDestination } from './drive-destination'

/** A tiny in-memory Google Drive, speaking just enough of the REST API. */
function fakeDrive() {
  interface Node {
    id: string
    name: string
    parent: string
    mimeType: string
    data: Uint8Array
    trashed: boolean
  }
  const nodes = new Map<string, Node>()
  const log: string[] = []
  let next = 1
  const create = (name: string, parent: string, mimeType: string, data = new Uint8Array(0)) => {
    const node: Node = { id: `id${next++}`, name, parent, mimeType, data, trashed: false }
    nodes.set(node.id, node)
    return node
  }
  const describeNode = (n: Node) => ({ id: n.id, name: n.name, size: String(n.data.length), mimeType: n.mimeType })

  // Drive's listings lag behind writes: ids here are left out of, or still
  // shown in, the answer to a listing.
  const unlisted = new Set<string>()
  const stillListed = new Set<string>()

  let failing = { count: 0, status: 500 }
  const failNext = (count: number, status: number) => (failing = { count, status })

  const drive = new Drive(async (url, init) => {
    if (failing.count > 0) {
      failing.count--
      return new Response(null, { status: failing.status })
    }
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    log.push(`${method} ${u.pathname}${u.searchParams.get('uploadType') ? `?${u.searchParams.get('uploadType')}` : ''}`)
    const id = u.pathname.split('/files/')[1]

    if (method === 'GET' && u.pathname.endsWith('/files')) {
      const q = u.searchParams.get('q')!
      const parent = q.match(/'([^']+)' in parents/)![1]
      const name = q.match(/name = '([^']+)'/)?.[1]
      const files = [...nodes.values()].filter(
        (n) =>
          n.parent === parent &&
          (stillListed.has(n.id) || (!n.trashed && !unlisted.has(n.id))) &&
          (!name || (n.name === name && n.mimeType === DRIVE_FOLDER_MIME)),
      )
      return Response.json({ files: files.map(describeNode) })
    }
    if (method === 'POST' && u.searchParams.get('uploadType') === 'multipart') {
      const text = new TextDecoder().decode(await new Response(init!.body).arrayBuffer())
      const [, meta, content] = text.split(/\r\n\r\n/)
      const { name, parents } = JSON.parse(meta.split('\r\n--')[0])
      return Response.json(describeNode(create(name, parents[0], 'application/octet-stream', utf8(content.split('\r\n--')[0]))))
    }
    if (method === 'POST') {
      const { name, parents, mimeType } = JSON.parse(init!.body as string)
      return Response.json({ id: create(name, parents[0], mimeType).id })
    }
    if (method === 'PATCH' && u.searchParams.get('uploadType') === 'media') {
      nodes.get(id)!.data = new Uint8Array(await new Response(init!.body).arrayBuffer())
      return Response.json({})
    }
    if (method === 'PATCH') {
      nodes.get(id)!.trashed = true
      return Response.json({})
    }
    if (method === 'GET' && u.searchParams.get('alt') === 'media') {
      const node = nodes.get(id)!
      const range = (init!.headers as Record<string, string>).Range?.match(/bytes=(\d+)-(\d+)/)
      if (!range) return new Response(node.data as Uint8Array<ArrayBuffer>)
      return new Response(node.data.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
    }
    return new Response(null, { status: 404 })
  })
  return { drive, nodes, log, create, failNext, unlisted, stillListed }
}

const token = async () => 't'

describe('DriveDestination', () => {
  it('creates XkyHold/<name> and stores objects in sub-folders', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'My computer')
    await dest.put('packs', 'abc', utf8('pack bytes'))
    await dest.put('', 'config', utf8('{}'))

    const path = (n: { name: string; parent: string }): string =>
      n.parent === 'root' ? n.name : `${path(fake.nodes.get(n.parent)!)}/${n.name}`
    expect([...fake.nodes.values()].map(path).sort()).toEqual([
      APP_FOLDER,
      `${APP_FOLDER}/My computer`,
      `${APP_FOLDER}/My computer/config`,
      `${APP_FOLDER}/My computer/packs`,
      `${APP_FOLDER}/My computer/packs/abc`,
    ])
    expect(await dest.get('packs', 'abc')).toEqual(utf8('pack bytes'))
    expect(await dest.get('packs', 'abc', { offset: 5, length: 5 })).toEqual(utf8('bytes'))
    expect(await dest.list('packs')).toEqual([{ name: 'abc', size: 10, sha256: undefined }])
  })

  it('finds objects written by an earlier session', async () => {
    const fake = fakeDrive()
    await (await DriveDestination.forName(fake.drive, token, 'repo')).put('index', 'i1', utf8('index'))
    const later = await DriveDestination.forName(fake.drive, token, 'repo')
    expect(await later.get('index', 'i1')).toEqual(utf8('index'))
    expect([...fake.nodes.values()].filter((n) => n.name === 'repo')).toHaveLength(1)
  })

  it('does not upload a content-named object twice', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'repo')
    await dest.put('packs', 'abc', utf8('same'))
    const uploads = () => fake.log.filter((l) => l.includes('multipart')).length
    const before = uploads()
    await dest.put('packs', 'abc', utf8('same'))
    expect(uploads()).toBe(before)
  })

  it('rewrites config in place instead of creating a second one', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'repo')
    await dest.put('', 'config', utf8('one'))
    await dest.put('', 'config', utf8('two'))
    expect([...fake.nodes.values()].filter((n) => n.name === 'config')).toHaveLength(1)
    expect(await dest.get('', 'config')).toEqual(utf8('two'))
  })

  it('reports missing objects and forgets trashed ones', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'repo')
    await expect(dest.get('snapshots', 'nope')).rejects.toThrow(NotFoundError)
    await dest.put('snapshots', 's1', utf8('x'))
    await dest.trash('snapshots', 's1')
    await expect(dest.get('snapshots', 's1')).rejects.toThrow(NotFoundError)
    expect([...fake.nodes.values()].find((n) => n.name === 's1')!.trashed).toBe(true)
  })

  it('opens a whole repository with one listing per folder', async () => {
    const fake = fakeDrive()
    const first = await DriveDestination.forName(fake.drive, token, 'repo')
    await first.put('packs', 'p1', utf8('x'))
    await first.put('index', 'i1', utf8('y'))

    const later = await DriveDestination.forName(fake.drive, token, 'repo')
    fake.log.length = 0
    await later.warm()
    // repo folder once, then packs, index and snapshots; snapshots is created, not listed
    expect(fake.log.filter((l) => l.startsWith('GET')).length).toBe(3)
    expect(fake.log.filter((l) => l.startsWith('POST')).length).toBe(1)
    fake.log.length = 0
    expect(await later.list('snapshots')).toEqual([])
    expect((await later.list('packs')).map((o) => o.name)).toEqual(['p1'])
    expect(fake.log).toEqual([])
  })

  it('retries when Drive is briefly unavailable, and gives up on real errors', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'repo')
    await dest.put('packs', 'p1', utf8('data'))
    const waits: number[] = []
    dest.wait = async (ms) => void waits.push(ms)

    fake.failNext(2, 503)
    expect(await dest.get('packs', 'p1')).toEqual(utf8('data'))
    expect(waits).toEqual([500, 1500])

    fake.failNext(1, 404)
    await expect(dest.get('packs', 'p1')).rejects.toMatchObject({ status: 404 })
    fake.failNext(10, 503)
    await expect(dest.get('packs', 'p1')).rejects.toMatchObject({ status: 503 })
  })

  it('keeps its own writes and removals when a fresh listing lags behind', async () => {
    const fake = fakeDrive()
    const dest = await DriveDestination.forName(fake.drive, token, 'repo')
    const node = (name: string) => [...fake.nodes.values()].find((n) => n.name === name)!

    // Just written, not yet in Drive's listing: still known, and can be trashed.
    await dest.put('locks', 'mine', utf8('lock'))
    fake.unlisted.add(node('mine').id)
    expect((await dest.list('locks', true)).map((o) => o.name)).toEqual(['mine'])
    await dest.trash('locks', 'mine')
    expect(node('mine').trashed).toBe(true)

    // Just trashed, still in Drive's listing: gone for this session.
    fake.stillListed.add(node('mine').id)
    expect(await dest.list('locks', true)).toEqual([])
    await expect(dest.get('locks', 'mine')).rejects.toThrow(NotFoundError)

    // Another device's file shows up as usual.
    fake.create('theirs', node('locks').id, 'application/octet-stream', utf8('x'))
    expect((await dest.list('locks', true)).map((o) => o.name)).toEqual(['theirs'])
  })

  it('lists repositories, ignoring loose files', async () => {
    const fake = fakeDrive()
    await DriveDestination.forName(fake.drive, token, 'laptop')
    await DriveDestination.forName(fake.drive, token, 'desktop')
    const app = [...fake.nodes.values()].find((n) => n.name === APP_FOLDER)!
    fake.create('stray.txt', app.id, 'text/plain')
    const names = (await DriveDestination.listRepositories(fake.drive, token)).map((r) => r.name).sort()
    expect(names).toEqual(['desktop', 'laptop'])
  })
})
