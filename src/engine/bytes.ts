// Small byte helpers shared by the engine. No dependencies.

export type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const utf8 = (text: string): Bytes => encoder.encode(text) as Bytes
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes)

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('Invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Crockford base32, in hyphen-separated groups of four. */
export function toBase32Groups(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)?.join('-') ?? ''
}

/**
 * Reads Crockford base32 leniently: ignores case, spaces and hyphens, and
 * maps O to 0 and I/L to 1. Returns null if anything else is wrong.
 */
export function fromBase32Groups(text: string, length: number): Bytes | null {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (clean.length !== Math.ceil((length * 8) / 5)) return null
  const out = new Uint8Array(length)
  let bits = 0
  let value = 0
  let index = 0
  for (const char of clean) {
    const digit = CROCKFORD.indexOf(char)
    if (digit < 0) return null
    value = (value << 5) | digit
    bits += 5
    if (bits >= 8) {
      if (index < length) out[index++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

async function through(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Bytes> {
  const piped = new Blob([data as Bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

/** Raw DEFLATE (encoding 1 in the format spec). */
export const deflate = (data: Uint8Array): Promise<Bytes> =>
  through(data, new CompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>)

export const inflate = (data: Uint8Array): Promise<Bytes> =>
  through(data, new DecompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>)

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Bytes)))
}
