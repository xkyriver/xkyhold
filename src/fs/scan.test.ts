import { describe, expect, it } from 'vitest'
import type { DirHandleLike, FileHandleLike } from './handles'
import { scanFolder } from './scan'

function file(name: string, size: number, broken = false): FileHandleLike {
  return {
    kind: 'file',
    name,
    getFile: async () => {
      if (broken) throw new Error('locked')
      return { size, lastModified: 0, slice: () => new Blob() }
    },
  }
}

function dir(name: string, entries: (FileHandleLike | DirHandleLike)[], broken = false): DirHandleLike {
  return {
    kind: 'directory',
    name,
    async *values() {
      if (broken) throw new Error('denied')
      yield* entries
    },
  }
}

describe('scanFolder', () => {
  it('totals files across nested folders', async () => {
    const root = dir('root', [file('a', 10), dir('sub', [file('b', 5), dir('deep', [file('c', 1)])])])
    expect(await scanFolder(root)).toEqual({ files: 3, bytes: 16, skipped: 0 })
  })

  it('handles an empty folder', async () => {
    expect(await scanFolder(dir('root', []))).toEqual({ files: 0, bytes: 0, skipped: 0 })
  })

  it('skips unreadable files and folders without failing', async () => {
    const root = dir('root', [file('a', 10), file('locked', 99, true), dir('denied', [file('x', 1)], true)])
    expect(await scanFolder(root)).toEqual({ files: 1, bytes: 10, skipped: 2 })
  })

  it('reports the final totals through onProgress', async () => {
    const seen: number[] = []
    await scanFolder(dir('root', [file('a', 1), file('b', 2)]), { onProgress: (r) => seen.push(r.bytes) })
    expect(seen.at(-1)).toBe(3)
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(scanFolder(dir('root', [file('a', 1)]), { signal: controller.signal })).rejects.toThrow()
  })
})
