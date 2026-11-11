const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 1536 -> "1.5 KB". Binary multiples, one decimal below 10. */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}
