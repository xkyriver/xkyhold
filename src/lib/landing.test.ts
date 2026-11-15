import { describe, expect, it } from 'vitest'
import { onLinuxDesktop } from './landing'

describe('Linux desktop', () => {
  it('knows a Linux desktop from Android, ChromeOS and the others', () => {
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
    const chromeos = 'Mozilla/5.0 (X11; CrOS x86_64 16181.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    expect(onLinuxDesktop(firefox, 'Linux x86_64')).toBe(true)
    expect(onLinuxDesktop(chrome, 'Linux')).toBe(true)
    expect(onLinuxDesktop(android, 'Android')).toBe(false)
    expect(onLinuxDesktop(chromeos, 'Chrome OS')).toBe(false)
    expect(onLinuxDesktop(windows, 'Windows')).toBe(false)
    expect(onLinuxDesktop(mac, 'MacIntel')).toBe(false)
  })
})
