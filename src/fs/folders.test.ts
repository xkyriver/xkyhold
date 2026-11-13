import { describe, expect, it } from 'vitest'
import { clashes, sortDropped, toggleLeftOut } from './folders'

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
    expect(result.files.map((f) => f.name)).toEqual(['notes.txt'])
    expect(result.refused).toBe(2)
  })
})

describe('clashes', () => {
  const folders = [{ name: 'Work' }, { name: 'Personal', group: 'Documents' }, { name: 'Old', group: 'Documents' }]

  it('refuses a second folder with the same name in the same place', () => {
    expect(clashes(folders, 'Personal', 'Documents')).toBe(true)
    expect(clashes(folders, 'Work')).toBe(true)
  })

  it('allows the same name in different places', () => {
    expect(clashes(folders, 'Work', 'Documents')).toBe(false)
    expect(clashes(folders, 'Personal')).toBe(false)
  })

  it('refuses a loose folder named like a folder made in XkyHold', () => {
    expect(clashes(folders, 'Documents')).toBe(true)
  })
})
