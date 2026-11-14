// Reading backups made by XkyHold-lx (docs/FORMAT-v2.md). golden-v2-repo.json
// was written once by XkyHold-lx and frozen with the spec; it is a
// byte-for-byte copy of the fixture in that repository. Never regenerate it:
// if this test fails, the change under test cannot read Linux backups.

import { describe, expect, it } from 'vitest'
import { MemoryDestination } from '../storage/memory'
import { fromBase64, sha256Hex, utf8 } from './bytes'
import type { Bytes } from './bytes'
import golden from './golden-v2-repo.json'
import { Repository } from './repo'
import type { TreeEntry, TreeFile, TreeSymlink } from './repo'
import { readFile, restoreEntries } from './restore'
import type { RestoreTarget } from './restore'
import { MemoryTarget } from './testing'

interface Expected {
  path: string
  type: 'file' | 'dir' | 'symlink'
  sha256?: string
  size?: number
  target?: string
}

const bytesOf = (b64: string) => fromBase64(b64)
const decoder = new TextDecoder('utf-8', { fatal: false })
/** How a browser shows a name: invalid UTF-8 replaced by U+FFFD. */
const display = (bytes: Bytes) => decoder.decode(bytes)
const key = (bytes: Bytes) => [...bytes].join(',')

async function load(): Promise<MemoryDestination> {
  const dest = new MemoryDestination()
  for (const [k, v] of Object.entries(golden.objects)) dest.objects.set(k, fromBase64(v))
  return dest
}

async function contents(repo: Repository, file: TreeFile): Promise<Bytes> {
  const parts: Bytes[] = []
  for await (const chunk of readFile(repo, file)) parts.push(chunk)
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

describe('format v2 golden repository (written by XkyHold-lx)', () => {
  it.each([
    ['password', { password: golden.password }],
    ['recovery key', { recoveryKey: golden.recoveryKey }],
  ])('opens with the %s, restore-only', async (_name, credential) => {
    const repo = await Repository.open(await load(), credential)
    expect(repo.format).toBe(2)
    const snapshots = await repo.listSnapshots()
    expect(snapshots.map((s) => s.id)).toEqual([golden.snapshotId])
    expect(snapshots[0]).toMatchObject({ format: 2, roots: [{ name: 'home', source: { kind: 'home', path: '' } }] })
    expect(snapshots[0].home?.path).toMatch(/^\//)
  })

  it('reads every entry, byte for byte', async () => {
    const repo = await Repository.open(await load(), { password: golden.password })
    const [snapshot] = await repo.listSnapshots()
    const found = new Map<string, { type: string; sha256?: string; size?: number; target?: string }>()
    const walk = async (prefix: Bytes, tree: string) => {
      for (const entry of (await repo.loadTree(tree)) as (TreeEntry & { nameBytes?: string })[]) {
        const name = entry.nameBytes ? bytesOf(entry.nameBytes) : utf8(entry.name)
        // The display name is the name with invalid UTF-8 replaced.
        expect(entry.name).toBe(display(name))
        const path = prefix.length ? new Uint8Array([...prefix, 0x2f, ...name]) : name
        if (entry.type === 'dir') {
          found.set(key(path), { type: 'dir' })
          await walk(path, entry.subtree)
        } else if (entry.type === 'symlink') {
          found.set(key(path), { type: 'symlink', target: entry.target })
        } else {
          const data = await contents(repo, entry)
          found.set(key(path), { type: 'file', size: data.length, sha256: await sha256Hex(data) })
        }
      }
    }
    await walk(new Uint8Array(0), snapshot.roots[0].tree)

    const expected = golden.expected as Expected[]
    expect([...found.keys()].sort()).toEqual(expected.map((e) => key(bytesOf(e.path))).sort())
    for (const e of expected) {
      const got = found.get(key(bytesOf(e.path)))!
      expect(got.type).toBe(e.type)
      if (e.type === 'file') expect(got).toMatchObject({ size: e.size, sha256: e.sha256 })
      if (e.type === 'symlink') expect(utf8(got.target!)).toEqual(bytesOf(e.target!))
    }
  })

  it('restores what a browser can, and says what it could not', async () => {
    const repo = await Repository.open(await load(), { password: golden.password })
    const [snapshot] = await repo.listSnapshots()
    const target = new MemoryTarget()
    const done = await restoreEntries(repo, await repo.loadTree(snapshot.roots[0].tree), target)
    // Two links, no way to create them in a folder from a browser.
    expect(done.links).toBe(2)
    expect(done.unknown ?? 0).toBe(0)
    // "x\xfe" and "x\xff" both show as "x�": the second gets a new name.
    expect(done.renamed).toBe(1)
    const files = [...target.files.keys()]
    expect(files).toContain('x�')
    expect(files).toContain('x� (2)')
    expect(files).toContain('bad�name')
    expect(target.files.get('Documents/big.bin')?.length).toBe(3000)
    // The disk that was not crossed comes back as an empty folder.
    expect(target.dirs.has('Disk/')).toBe(true)
    expect(files.some((f) => f.startsWith('Disk/'))).toBe(false)
    // Every file in the backup came back.
    const expectedFiles = (golden.expected as Expected[]).filter((e) => e.type === 'file').length
    expect(done.files).toBe(expectedFiles)
  })

  it('keeps links where the target can hold them (a .zip)', async () => {
    const repo = await Repository.open(await load(), { password: golden.password })
    const [snapshot] = await repo.listSnapshots()
    const links: TreeSymlink[] = []
    const linkTarget = (): RestoreTarget => ({
      createDir: async () => linkTarget(),
      writeFile: async (_f, chunks) => {
        for await (const _ of chunks) void _
      },
      writeLink: async (link) => void links.push(link),
    })
    const done = await restoreEntries(repo, await repo.loadTree(snapshot.roots[0].tree), linkTarget())
    expect(done.links ?? 0).toBe(0)
    expect(links.map((l) => [l.name, l.target]).sort()).toEqual([
      ['dangling', 'does/not/exist'],
      ['link', 'notes.txt'],
    ])
  })
})
