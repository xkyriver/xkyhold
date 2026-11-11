import type { Bytes } from '../engine/bytes'
import { sha256Hex } from '../engine/bytes'
import { NotFoundError } from './destination'
import type { Destination, Dir, StoredObject } from './destination'

/** A destination that lives in memory. For tests. */
export class MemoryDestination implements Destination {
  readonly objects = new Map<string, Bytes>()
  readonly trashed = new Map<string, Bytes>()
  puts = 0
  gets = 0
  /** When set, the put with this number (1-based) and all later ones fail. */
  failPutsFrom: number | null = null

  private key(dir: Dir, name: string): string {
    return `${dir}/${name}`
  }

  async put(dir: Dir, name: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.puts++
    if (this.failPutsFrom !== null && this.puts >= this.failPutsFrom) throw new TypeError('network down')
    this.objects.set(this.key(dir, name), data.slice() as Bytes)
  }

  async get(dir: Dir, name: string, range?: { offset: number; length: number }): Promise<Bytes> {
    this.gets++
    const data = this.objects.get(this.key(dir, name))
    if (!data) throw new NotFoundError(dir, name)
    return range ? data.slice(range.offset, range.offset + range.length) : data.slice()
  }

  async list(dir: Dir): Promise<StoredObject[]> {
    const out: StoredObject[] = []
    for (const [key, data] of this.objects) {
      const slash = key.indexOf('/')
      if (key.slice(0, slash) === dir) out.push({ name: key.slice(slash + 1), size: data.length, sha256: await sha256Hex(data) })
    }
    return out
  }

  async trash(dir: Dir, name: string): Promise<void> {
    const key = this.key(dir, name)
    const data = this.objects.get(key)
    if (!data) throw new NotFoundError(dir, name)
    this.trashed.set(key, data)
    this.objects.delete(key)
  }

  names(dir: Dir): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1))
  }
}
