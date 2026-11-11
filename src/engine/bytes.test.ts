import { describe, expect, it } from 'vitest'
import { deflate, fromBase32Groups, fromBase64, fromHex, inflate, sha256Hex, toBase32Groups, toBase64, toHex, utf8 } from './bytes'

describe('encodings', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255])

  it('round-trips hex and base64', () => {
    expect(toHex(bytes)).toBe('00017f80ff')
    expect(fromHex('00017F80ff')).toEqual(bytes)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('rejects bad hex', () => {
    expect(() => fromHex('abc')).toThrow()
    expect(() => fromHex('zz')).toThrow()
  })

  it('matches a known SHA-256', async () => {
    expect(await sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('round-trips DEFLATE', async () => {
    const text = utf8('xkyhold '.repeat(1000))
    const packed = await deflate(text)
    expect(packed.length).toBeLessThan(text.length / 10)
    expect(await inflate(packed)).toEqual(text)
  })
})

describe('recovery key text', () => {
  const key = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 255)

  it('is 52 characters in groups of four', () => {
    const text = toBase32Groups(key)
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(fromBase32Groups(text, 32)).toEqual(key)
  })

  it('forgives case, spacing and look-alike letters', () => {
    const text = toBase32Groups(new Uint8Array(32)) // all zeros -> all "0"
    const sloppy = text.toLowerCase().replace(/-/g, ' ').replace('0', 'o').replace('0', 'O')
    expect(fromBase32Groups(sloppy, 32)).toEqual(new Uint8Array(32))
    const ones = toBase32Groups(fromHex('08'.padEnd(64, '0'))) // first char is "1"
    expect(fromBase32Groups(ones.replace('1', 'l'), 32)).toEqual(fromHex('08'.padEnd(64, '0')))
  })

  it('rejects the wrong length or alphabet', () => {
    expect(fromBase32Groups('ABCD', 32)).toBeNull()
    expect(fromBase32Groups(toBase32Groups(key).replace(/.$/, 'U'), 32)).toBeNull()
  })
})
