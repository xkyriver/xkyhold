// Errors cross the Web Worker boundary as plain data, so the kind of
// failure is decided here, on the engine's side, and travels as a string.
//
// Errors are recognised by name, not by class, so that the page can import
// this module without pulling the whole engine into its bundle.

export type ErrorKind =
  | 'wrong-key'
  | 'session' // the Google session is missing or expired
  | 'format' // not an XkyHold backup, or a newer format; the message says which
  | 'exists' // a backup with that name already exists
  | 'damaged' // data in the backup is corrupt or missing
  | 'read' // a chosen folder could not be read
  | 'refused' // Drive said no: quota, permissions
  | 'network'
  | 'aborted'
  | 'other'

export class EngineError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string = kind,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

export interface SerializedError {
  kind: ErrorKind
  message: string
}

/** Classifies any error thrown by the engine or the storage layer. */
export function classify(err: unknown): SerializedError {
  const message = err instanceof Error ? err.message : String(err)
  const named = (name: string) => err instanceof Error && err.name === name
  const status = (err as { status?: unknown })?.status

  if (err instanceof EngineError) return { kind: err.kind, message }
  if (named('WrongKeyError')) return { kind: 'wrong-key', message }
  if (named('FormatError')) return { kind: 'format', message }
  if (named('AuthenticationError') || named('MissingBlobError')) return { kind: 'damaged', message }
  if (named('FileReadError')) return { kind: 'read', message }
  if (named('AbortError')) return { kind: 'aborted', message }
  if (named('AuthError') || status === 401) return { kind: 'session', message }
  if (status === 403) return { kind: 'refused', message }
  if (err instanceof TypeError || status === 429 || (typeof status === 'number' && status >= 500)) {
    return { kind: 'network', message }
  }
  return { kind: 'other', message }
}
