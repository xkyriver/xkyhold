// In-memory stand-ins for the browser's file handles and for a restore
// target. Used by the engine's tests only.

import type { DirHandleLike, FileHandleLike } from '../fs/handles'
import { concat } from './bytes'
import type { Bytes } from './bytes'
import type { TreeFile } from './repo'
import type { RestoreTarget } from './restore'

export class FakeFile implements FileHandleLike {
  readonly kind = 'file'
  reads = 0
  unreadable = false

  constructor(
    public name: string,
    public data: Uint8Array,
    public mtime = 1_794_400_000_000,
  ) {}

  async getFile() {
    if (this.unreadable) throw new Error('locked')
    const { data } = this
    return {
      size: data.length,
      lastModified: this.mtime,
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => {
          this.reads++
          return data.slice(start, end).buffer as ArrayBuffer
        },
      }),
    }
  }
}

export class FakeDir implements DirHandleLike {
  readonly kind = 'directory'
  unreadable = false

  constructor(
    public name: string,
    public children: (FakeFile | FakeDir)[] = [],
  ) {}

  async *values() {
    if (this.unreadable) throw new Error('denied')
    yield* this.children
  }

  file(path: string): FakeFile {
    const [head, ...rest] = path.split('/')
    const child = this.children.find((c) => c.name === head)
    if (!child) throw new Error(`no ${head} in ${this.name}`)
    if (rest.length === 0) return child as FakeFile
    return (child as FakeDir).file(rest.join('/'))
  }

  /** Every file as "path" -> bytes, every empty folder as "path/" -> null. */
  flatten(prefix = ''): Map<string, Uint8Array | null> {
    const out = new Map<string, Uint8Array | null>()
    for (const child of this.children) {
      const path = prefix + child.name
      if (child instanceof FakeFile) out.set(path, child.data)
      else if (child.children.length === 0) out.set(`${path}/`, null)
      else for (const [k, v] of child.flatten(`${path}/`)) out.set(k, v)
    }
    return out
  }
}

export class MemoryTarget implements RestoreTarget {
  readonly files = new Map<string, Bytes>()
  readonly dirs = new Set<string>()
  readonly mtimes = new Map<string, number>()

  constructor(
    private readonly root: MemoryTarget | null = null,
    private readonly prefix = '',
  ) {}

  private get top(): MemoryTarget {
    return this.root ?? this
  }

  async createDir(name: string): Promise<RestoreTarget> {
    this.top.dirs.add(`${this.prefix}${name}/`)
    return new MemoryTarget(this.top, `${this.prefix}${name}/`)
  }

  async writeFile(file: TreeFile, chunks: AsyncIterable<Bytes>): Promise<void> {
    const parts: Bytes[] = []
    for await (const chunk of chunks) parts.push(chunk)
    this.top.files.set(this.prefix + file.name, concat(...parts))
    this.top.mtimes.set(this.prefix + file.name, file.mtime)
  }

  /** Same shape as FakeDir.flatten, for comparing. */
  flatten(): Map<string, Uint8Array | null> {
    const out = new Map<string, Uint8Array | null>(this.files)
    for (const dir of this.dirs) {
      const used = [...this.files.keys(), ...this.dirs].some((k) => k !== dir && k.startsWith(dir))
      if (!used) out.set(dir, null)
    }
    return out
  }
}

/** Deterministic pseudo-random bytes. */
export function noise(length: number, seed = 1): Bytes {
  const out = new Uint8Array(length)
  let x = seed * 2654435761 + 1
  for (let i = 0; i < length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out[i] = x & 255
  }
  return out
}
