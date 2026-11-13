import { describe, expect, it } from 'vitest'
import type { DirHandleLike } from '../fs/handles'
import { backupRoots } from './roots'

const handle = (name: string) => ({ kind: 'directory', name }) as unknown as DirHandleLike

describe('backupRoots', () => {
  it('keeps loose folders as they are and gathers grouped ones under their folder', () => {
    const roots = backupRoots([
      { id: '1', name: 'Music', handle: handle('Music'), leaveOut: ['Old'] },
      { id: '2', name: 'Personal', handle: handle('Personal'), group: 'Documents' },
      { id: '3', name: 'Projects', handle: handle('Projects'), group: 'Documents', leaveOut: ['Old', 'Tmp/Cache'] },
    ])
    expect(roots.map((r) => r.name)).toEqual(['Music', 'Documents'])
    expect(roots[0]).toMatchObject({ handle: handle('Music'), leaveOut: ['Old'] })
    expect(roots[1].members?.map((m) => m.name)).toEqual(['Personal', 'Projects'])
    expect(roots[1].leaveOut).toEqual(['Projects/Old', 'Projects/Tmp/Cache'])
    expect(roots[1].handle).toBeUndefined()
  })

  it('puts grouped files with the folders, and never makes a loose file a top-level folder', () => {
    const file = (name: string) => ({ kind: 'file', name }) as unknown as DirHandleLike
    const roots = backupRoots([
      { id: '1', name: 'take.m4a', handle: file('take.m4a'), group: 'Audio' },
      { id: '2', name: 'stray.txt', handle: file('stray.txt') },
    ])
    expect(roots.map((r) => r.name)).toEqual(['Audio'])
    expect(roots[0].members?.map((m) => m.name)).toEqual(['take.m4a'])
  })
})
