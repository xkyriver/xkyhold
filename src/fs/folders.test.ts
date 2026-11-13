import { describe, expect, it } from 'vitest'
import { sortDropped, toggleLeftOut } from './folders'

describe('toggleLeftOut', () => {
  it('adds a folder once, in order', () => {
    expect(toggleLeftOut(['Videos'], 'Downloads', true)).toEqual(['Downloads', 'Videos'])
    expect(toggleLeftOut(['Downloads'], 'Downloads', true)).toEqual(['Downloads'])
  })

  it('drops folders inside one that is left out, which it already covers', () => {
    expect(toggleLeftOut(['Work/Old', 'Work/Older/x', 'Workshop'], 'Work', true)).toEqual(['Work', 'Workshop'])
  })

  it('puts a folder back without touching the others', () => {
    expect(toggleLeftOut(['Downloads', 'Videos'], 'Downloads', false)).toEqual(['Videos'])
  })
})

describe('sortDropped', () => {
  type Item = { kind: 'file' | 'directory'; name: string }
  const dir: Item = { kind: 'directory', name: 'Work' }
  const file: Item = { kind: 'file', name: 'notes.txt' }

  it('keeps the folders, counts files and what the browser refused', () => {
    const result = sortDropped<Item>([
      { status: 'fulfilled', value: dir },
      { status: 'fulfilled', value: file },
      { status: 'fulfilled', value: null },
      { status: 'rejected', reason: new DOMException('blocked') },
      { status: 'fulfilled', value: { kind: 'directory', name: 'Personal' } },
    ])
    expect(result.dirs.map((d) => d.name)).toEqual(['Work', 'Personal'])
    expect(result.files).toBe(1)
    expect(result.refused).toBe(2)
  })
})
