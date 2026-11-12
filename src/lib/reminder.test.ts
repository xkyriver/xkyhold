import { describe, expect, it } from 'vitest'
import { reminder } from './reminder'

const now = new Date('2026-11-12T12:00:00Z')

describe('reminder', () => {
  it('is not due right after a backup', () => {
    expect(reminder('2026-11-12T09:00:00Z', 1, now)).toEqual({ due: false, days: 0 })
  })

  it('is due once the interval has passed', () => {
    expect(reminder('2026-11-11T12:00:00Z', 1, now)).toEqual({ due: true, days: 1 })
    expect(reminder('2026-11-11T12:00:01Z', 1, now).due).toBe(false)
    expect(reminder('2026-11-06T12:00:00Z', 7, now)).toEqual({ due: false, days: 6 })
    expect(reminder('2026-11-05T11:00:00Z', 7, now)).toEqual({ due: true, days: 7 })
  })

  it('is due when there is no backup at all', () => {
    expect(reminder(null, 1, now)).toEqual({ due: true, days: null })
  })

  it('never fires when reminders are off', () => {
    expect(reminder('2020-01-01T00:00:00Z', 0, now).due).toBe(false)
    expect(reminder(null, 0, now).due).toBe(false)
  })

  it('copes with a clock that went backwards', () => {
    expect(reminder('2026-11-13T12:00:00Z', 1, now)).toEqual({ due: false, days: 0 })
  })
})
