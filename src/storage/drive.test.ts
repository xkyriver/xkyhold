import { describe, expect, it } from 'vitest'
import { CHUNK_UNIT, Drive, DriveError, nextOffset, uploadResumable } from './drive'
import type { FetchLike } from './drive'

/** A fake resumable-upload endpoint that stores whatever is PUT to it. */
function fakeSession(total: number) {
  const received = new Uint8Array(total)
  let have = 0
  const requests: string[] = []
  let failNext = false

  const fetch: FetchLike = async (_url, init) => {
    const range = (init?.headers as Record<string, string>)['Content-Range']
    requests.push(range)
    if (failNext) {
      failNext = false
      throw new TypeError('network down')
    }
    const chunk = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
    if (chunk) {
      const start = Number(chunk[1])
      if (start !== have) return new Response(null, { status: 400 })
      const bytes = new Uint8Array(await (init!.body as Blob).arrayBuffer())
      received.set(bytes, start)
      have += bytes.length
    }
    if (have === total) return Response.json({ id: 'f1', name: 'test', size: String(total) })
    return new Response(null, { status: 308, headers: have > 0 ? { Range: `bytes=0-${have - 1}` } : {} })
  }

  return { fetch, received, requests, breakNext: () => (failNext = true) }
}

function payload(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i % 251
  return bytes
}

describe('nextOffset', () => {
  it('reads the Range header', () => {
    expect(nextOffset('bytes=0-524287')).toBe(524288)
  })

  it('is 0 when nothing was received yet', () => {
    expect(nextOffset(null)).toBe(0)
  })
})

describe('uploadResumable', () => {
  const size = CHUNK_UNIT * 2 + 1000

  it('sends the data in chunks and returns the file', async () => {
    const session = fakeSession(size)
    const data = payload(size)
    const file = await uploadResumable(new Drive(session.fetch), 'session', new Blob([data]), { chunkSize: CHUNK_UNIT })
    expect(file.id).toBe('f1')
    expect(session.received).toEqual(data)
    expect(session.requests).toEqual([
      `bytes */${size}`,
      `bytes 0-${CHUNK_UNIT - 1}/${size}`,
      `bytes ${CHUNK_UNIT}-${CHUNK_UNIT * 2 - 1}/${size}`,
      `bytes ${CHUNK_UNIT * 2}-${size - 1}/${size}`,
    ])
  })

  it('continues from the server offset after an interruption', async () => {
    const session = fakeSession(size)
    const data = payload(size)
    const drive = new Drive(session.fetch)
    const blob = new Blob([data])

    session.requests.length = 0
    const progress: number[] = []
    // First attempt: status ok, first chunk ok, second chunk fails.
    let calls = 0
    const flaky = new Drive(async (url, init) => {
      if (++calls === 3) session.breakNext()
      return session.fetch(url, init)
    })
    await expect(uploadResumable(flaky, 'session', blob, { chunkSize: CHUNK_UNIT })).rejects.toThrow('network down')

    const file = await uploadResumable(drive, 'session', blob, {
      chunkSize: CHUNK_UNIT,
      onProgress: (sent) => progress.push(sent),
    })
    expect(file.id).toBe('f1')
    expect(session.received).toEqual(data)
    expect(progress[0]).toBe(CHUNK_UNIT) // resumed, not restarted
  })

  it('rounds the chunk size down to a multiple of 256 KiB', async () => {
    const session = fakeSession(size)
    await uploadResumable(new Drive(session.fetch), 'session', new Blob([payload(size)]), {
      chunkSize: CHUNK_UNIT + 5,
    })
    expect(session.requests[1]).toBe(`bytes 0-${CHUNK_UNIT - 1}/${size}`)
  })

  it('surfaces Drive errors with their status', async () => {
    const drive = new Drive(async () => Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 }))
    const error = await uploadResumable(drive, 'session', new Blob(['x'])).catch((e) => e)
    expect(error).toBeInstanceOf(DriveError)
    expect(error.needsSignIn).toBe(true)
    expect(error.message).toBe('Invalid Credentials')
  })
})

describe('Drive.ensureFolder', () => {
  it('reuses an existing folder', async () => {
    const calls: string[] = []
    const drive = new Drive(async (url, init) => {
      calls.push(init?.method ?? 'GET')
      return Response.json({ files: [{ id: 'existing' }] })
    })
    expect(await drive.ensureFolder('t', "It's mine")).toBe('existing')
    expect(calls).toEqual(['GET'])
  })

  it('creates the folder when missing', async () => {
    const drive = new Drive(async (_url, init) =>
      init?.method === 'POST' ? Response.json({ id: 'new' }) : Response.json({ files: [] }),
    )
    expect(await drive.ensureFolder('t', 'XkyHold')).toBe('new')
  })
})
