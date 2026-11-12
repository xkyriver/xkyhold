// When to remind the user to back up. XkyHold never starts a backup by
// itself: someone who opened the app to restore a file, or who has little
// time, must not find their connection busy with something they did not
// ask for. It only says that a backup is due, and lets them decide.

/** Days between reminders offered in Settings. 0 turns reminders off. */
export const REMINDER_CHOICES = [1, 2, 3, 7, 0] as const
export const DEFAULT_REMINDER_DAYS = 1

/** Months of history offered in Settings. 0 keeps everything. */
export const KEEP_CHOICES = [0, 3, 6, 12] as const
export const DEFAULT_KEEP_MONTHS = 0

import { now as clockNow } from './clock'

const DAY_MS = 24 * 60 * 60_000

export interface Reminder {
  due: boolean
  /** Whole days since the last backup; null when there is none yet. */
  days: number | null
}

export function reminder(lastBackup: string | null | undefined, everyDays: number, now: Date = clockNow()): Reminder {
  if (!lastBackup) return { due: everyDays > 0, days: null }
  const elapsed = now.getTime() - Date.parse(lastBackup)
  return { due: everyDays > 0 && elapsed >= everyDays * DAY_MS, days: Math.max(0, Math.floor(elapsed / DAY_MS)) }
}
