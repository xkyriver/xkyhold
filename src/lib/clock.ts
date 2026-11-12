// The time as the app sees it. In development, `?pretend-now=2026-01-10` in
// the address moves the clock of the page and of the engine to that day, so
// reminders and the removal of old backups can be tried without waiting
// months. Production builds always use the real time: the parameter is only
// read behind `import.meta.env.DEV`.

let offset = 0

export function now(): Date {
  return new Date(Date.now() + offset)
}

/** Milliseconds added to the real time. Only ever set in development. */
export function setClockOffset(ms: number): void {
  offset = ms
}

/**
 * The offset asked for by `?pretend-now=` in `search`, or 0. A bare date
 * keeps the current time of day, so the clock still moves forward.
 */
export function pretendOffset(search: string, real: number = Date.now()): number {
  const value = new URLSearchParams(search).get('pretend-now')
  if (!value) return 0
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const target = Date.parse(dateOnly ? `${value}T${new Date(real).toISOString().slice(11)}` : value)
  return Number.isNaN(target) ? 0 : target - real
}
