// Google Drive API v3 client: just what a backup needs. Every call takes
// the access token explicitly, so this module knows nothing about sign-in.
//
// Uploads use Drive's resumable protocol: one request opens a session and
// returns a session URL, then the content is PUT in chunks. The session URL
// stays valid for about a week, so an interrupted upload can continue from
// where the server says it stopped.

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Drive requires every chunk but the last to be a multiple of 256 KiB. */
export const CHUNK_UNIT = 256 * 1024

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveError'
  }

  /** The token expired or was revoked: sign in again and retry. */
  get needsSignIn(): boolean {
    return this.status === 401
  }

  /** Worth retrying later (rate limit or server trouble). */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

export interface DriveFile {
  id: string
  name: string
  size?: string
  sha256Checksum?: string
  mimeType?: string
}

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'

async function fail(res: Response): Promise<never> {
  let detail = ''
  try {
    detail = (await res.json())?.error?.message ?? ''
  } catch {
    // not JSON; the status is all we have
  }
  throw new DriveError(res.status, detail || `Google Drive answered ${res.status}`)
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export class Drive {
  constructor(private readonly fetch: FetchLike = (input, init) => globalThis.fetch(input, init)) {}

  private headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...extra }
  }

  /** Finds a folder by name under `parent` ('root' by default), creating it if missing. */
  async ensureFolder(token: string, name: string, parent = 'root'): Promise<string> {
    const q = `name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and ${quote(parent)} in parents and trashed = false`
    const found = await this.fetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
      headers: this.headers(token),
    })
    if (!found.ok) await fail(found)
    const existing = (await found.json()).files?.[0]?.id as string | undefined
    if (existing) return existing

    const created = await this.fetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: this.headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    })
    if (!created.ok) await fail(created)
    return (await created.json()).id
  }

  async getFile(token: string, id: string): Promise<DriveFile> {
    const res = await this.fetch(`${API}/files/${id}?fields=id,name,size,sha256Checksum`, {
      headers: this.headers(token),
    })
    if (!res.ok) await fail(res)
    return res.json()
  }

  async trashFile(token: string, id: string): Promise<void> {
    const res = await this.fetch(`${API}/files/${id}`, {
      method: 'PATCH',
      headers: this.headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ trashed: true }),
    })
    if (!res.ok) await fail(res)
  }

  /** Every non-trashed child of a folder. */
  async listChildren(token: string, folder: string): Promise<DriveFile[]> {
    const q = encodeURIComponent(`${quote(folder)} in parents and trashed = false`)
    const out: DriveFile[] = []
    let page = ''
    do {
      const res = await this.fetch(
        `${API}/files?q=${q}&fields=nextPageToken,files(id,name,size,sha256Checksum,mimeType)&pageSize=1000${page}`,
        { headers: this.headers(token) },
      )
      if (!res.ok) await fail(res)
      const body = await res.json()
      out.push(...(body.files ?? []))
      page = body.nextPageToken ? `&pageToken=${encodeURIComponent(body.nextPageToken)}` : ''
    } while (page)
    return out
  }

  /** Downloads a file's content, or `length` bytes from `offset`. */
  async download(token: string, id: string, range?: { offset: number; length: number }): Promise<Uint8Array<ArrayBuffer>> {
    if (range?.length === 0) return new Uint8Array(0)
    const headers = this.headers(token)
    if (range) headers.Range = `bytes=${range.offset}-${range.offset + range.length - 1}`
    const res = await this.fetch(`${API}/files/${id}?alt=media`, { headers })
    if (!res.ok) await fail(res)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // A server that ignores Range answers 200 with the whole file.
    if (range && res.status !== 206) return bytes.slice(range.offset, range.offset + range.length)
    return bytes
  }

  /** Creates a file in one request. For small content. */
  async uploadSmall(token: string, name: string, parent: string, data: Uint8Array, signal?: AbortSignal): Promise<DriveFile> {
    const boundary = `xkyhold${crypto.randomUUID().replace(/-/g, '')}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name, parents: [parent] }),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      data as Uint8Array<ArrayBuffer>,
      `\r\n--${boundary}--`,
    ])
    const res = await this.fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size`, {
      method: 'POST',
      headers: this.headers(token, { 'Content-Type': `multipart/related; boundary=${boundary}` }),
      body,
      signal,
    })
    if (!res.ok) await fail(res)
    return res.json()
  }

  /** Replaces the content of an existing file. */
  async replaceContent(token: string, id: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    const res = await this.fetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: this.headers(token, { 'Content-Type': 'application/octet-stream' }),
      body: data as Uint8Array<ArrayBuffer>,
      signal,
    })
    if (!res.ok) await fail(res)
  }

  /** Opens a resumable upload and returns its session URL. */
  async startUpload(token: string, name: string, parent: string, size: number): Promise<string> {
    const res = await this.fetch(`${UPLOAD_API}/files?uploadType=resumable`, {
      method: 'POST',
      headers: this.headers(token, {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      }),
      body: JSON.stringify({ name, parents: [parent] }),
    })
    if (!res.ok) await fail(res)
    const session = res.headers.get('Location')
    if (!session) throw new DriveError(res.status, 'Google Drive did not return an upload session')
    return session
  }

  /**
   * Asks the server how much of an upload it has. Returns the next byte to
   * send, or the finished file.
   */
  async uploadStatus(session: string, size: number): Promise<UploadStep> {
    const res = await this.fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } })
    return readStep(res)
  }

  /** Sends bytes [offset, offset + chunk.size) of an upload. */
  async uploadChunk(session: string, chunk: Blob, offset: number, size: number, signal?: AbortSignal): Promise<UploadStep> {
    const end = offset + chunk.size - 1
    const res = await this.fetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end}/${size}` },
      body: chunk,
      signal,
    })
    return readStep(res)
  }
}

export type UploadStep = { done: false; offset: number } | { done: true; file: DriveFile }

/** "bytes=0-524287" -> 524288 (the next byte to send). No header -> 0. */
export function nextOffset(range: string | null): number {
  const match = range?.match(/^bytes=0-(\d+)$/)
  return match ? Number(match[1]) + 1 : 0
}

async function readStep(res: Response): Promise<UploadStep> {
  if (res.status === 308) return { done: false, offset: nextOffset(res.headers.get('Range')) }
  if (res.ok) return { done: true, file: await res.json() }
  return fail(res)
}

export interface UploadOptions {
  /** Bytes per request; rounded down to a multiple of 256 KiB. */
  chunkSize?: number
  /** Skip asking the server where it is: true for a session just opened. */
  fresh?: boolean
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Uploads `data` through an open session, starting from wherever the
 * server already is. Safe to call again with the same session after an
 * interruption: it asks the server for its offset first.
 */
export async function uploadResumable(
  drive: Drive,
  session: string,
  data: Blob,
  options: UploadOptions = {},
): Promise<DriveFile> {
  const unit = Math.max(CHUNK_UNIT, Math.floor((options.chunkSize ?? 8 * 1024 * 1024) / CHUNK_UNIT) * CHUNK_UNIT)
  let step: UploadStep = options.fresh ? { done: false, offset: 0 } : await drive.uploadStatus(session, data.size)
  while (!step.done) {
    options.signal?.throwIfAborted()
    options.onProgress?.(step.offset, data.size)
    const chunk = data.slice(step.offset, Math.min(step.offset + unit, data.size))
    step = await drive.uploadChunk(session, chunk, step.offset, data.size, options.signal)
  }
  options.onProgress?.(data.size, data.size)
  return step.file
}
