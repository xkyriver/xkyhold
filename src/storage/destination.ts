// Where a repository lives. The engine only ever talks to this interface;
// Google Drive is one implementation, the in-memory one is for tests.

import type { Bytes } from '../engine/bytes'

/** The folders of a repository ('' is its root, where `config` lives). */
export type Dir = '' | 'packs' | 'index' | 'snapshots' | 'locks'

export interface StoredObject {
  name: string
  size: number
  /** Hex SHA-256 of the content, when the destination can report it. */
  sha256?: string
}

export interface Destination {
  put(dir: Dir, name: string, data: Uint8Array, signal?: AbortSignal): Promise<void>
  /** Reads a whole object, or `length` bytes from `offset`. */
  get(dir: Dir, name: string, range?: { offset: number; length: number }): Promise<Bytes>
  /** `fresh` asks the storage again instead of trusting what this session already saw. */
  list(dir: Dir, fresh?: boolean): Promise<StoredObject[]>
  /** Moves an object to the trash. Never deletes permanently. */
  trash(dir: Dir, name: string): Promise<void>
}

export class NotFoundError extends Error {
  constructor(dir: Dir, name: string) {
    super(`Not found in the backup: ${dir ? `${dir}/` : ''}${name}`)
    this.name = 'NotFoundError'
  }
}
