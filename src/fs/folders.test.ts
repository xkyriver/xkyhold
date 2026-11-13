import { describe, expect, it } from 'vitest'
import { toggleLeftOut } from './folders'

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
