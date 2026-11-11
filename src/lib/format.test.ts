import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [2 * 1024 ** 5, '2048 TB'],
  ])('%d -> %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected)
  })
})
