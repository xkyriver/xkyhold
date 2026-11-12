import { afterEach, describe, expect, it } from 'vitest'
import { now, pretendOffset, setClockOffset } from './clock'

describe('pretendOffset', () => {
  const real = Date.parse('2026-11-12T15:30:00.000Z')

  it('is zero without the parameter or with nonsense', () => {
    expect(pretendOffset('', real)).toBe(0)
    expect(pretendOffset('?restore-only', real)).toBe(0)
    expect(pretendOffset('?pretend-now=soon', real)).toBe(0)
  })

  it('moves a bare date to that day, keeping the time of day', () => {
    const offset = pretendOffset('?pretend-now=2026-01-10', real)
    expect(new Date(real + offset).toISOString()).toBe('2026-01-10T15:30:00.000Z')
  })

  it('accepts a full timestamp', () => {
    const offset = pretendOffset('?pretend-now=2026-11-14T08:00:00Z', real)
    expect(new Date(real + offset).toISOString()).toBe('2026-11-14T08:00:00.000Z')
  })
})

describe('now', () => {
  afterEach(() => setClockOffset(0))

  it('follows the offset', () => {
    setClockOffset(2 * 86_400_000)
    expect(now().getTime() - Date.now()).toBeGreaterThan(2 * 86_400_000 - 1000)
  })
})
