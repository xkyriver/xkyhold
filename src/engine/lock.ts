// Advisory locks (docs/FORMAT.md, section 10.4). Drive has no atomic
// "create if absent", so each side writes its lock first and looks second:
// two operations that start together both see each other and back off.

import type { Destination } from '../storage/destination'
import { fromUtf8, randomBytes, toHex, utf8 } from './bytes'
import { EngineError } from './errors'

export type LockKind = 'backup' | 'prune'

interface LockFile {
  kind: LockKind
  device: string
  time: string
}

/** A lock not refreshed for this long belongs to something that died. */
export const STALE_AFTER_MS = 30 * 60_000
export const REFRESH_EVERY_MS = 5 * 60_000
/** Dead locks older than this are tidied away by whoever sees them. */
const REMOVE_AFTER_MS = 24 * 60 * 60_000

export interface LockOptions {
  now?: () => number
  /** Refresh timer; tests pass a no-op. */
  every?: (ms: number, run: () => void) => () => void
}

const interval = (ms: number, run: () => void) => {
  const id = setInterval(run, ms)
  return () => clearInterval(id)
}

export class Lock {
  private constructor(
    private readonly dest: Destination,
    private readonly file: Omit<LockFile, 'time'>,
    private name: string,
    private readonly now: () => number,
    private stop: () => void,
  ) {}

  private static async write(dest: Destination, file: Omit<LockFile, 'time'>, now: () => number): Promise<string> {
    const name = toHex(randomBytes(16))
    const content: LockFile = { ...file, time: new Date(now()).toISOString() }
    await dest.put('locks', name, utf8(JSON.stringify(content)))
    return name
  }

  /**
   * Takes a lock or throws EngineError('busy').
   * - `backup` gives way to a running prune.
   * - `prune` gives way to anything else that is running.
   */
  static async acquire(dest: Destination, kind: LockKind, device: string, options: LockOptions = {}): Promise<Lock> {
    const now = options.now ?? Date.now
    const file = { kind, device }
    const name = await Lock.write(dest, file, now)
    const lock = new Lock(dest, file, name, now, () => {})
    try {
      for (const other of await dest.list('locks', true)) {
        if (other.name === name) continue
        let theirs: LockFile
        try {
          theirs = JSON.parse(fromUtf8(await dest.get('locks', other.name)))
        } catch {
          continue // unreadable, or released while we were looking
        }
        const age = now() - Date.parse(theirs.time)
        if (!(age < STALE_AFTER_MS)) {
          if (age > REMOVE_AFTER_MS) await dest.trash('locks', other.name).catch(() => {})
          continue
        }
        if (kind === 'prune' || theirs.kind === 'prune') throw new EngineError('busy', `Locked by ${theirs.device}`)
      }
    } catch (err) {
      await lock.release()
      throw err
    }
    lock.stop = (options.every ?? interval)(REFRESH_EVERY_MS, () => void lock.refresh().catch(() => {}))
    return lock
  }

  /** Objects are write-once, so refreshing means a new lock, then drop the old. */
  private async refresh(): Promise<void> {
    const previous = this.name
    this.name = await Lock.write(this.dest, this.file, this.now)
    await this.dest.trash('locks', previous).catch(() => {})
  }

  async release(): Promise<void> {
    this.stop()
    await this.dest.trash('locks', this.name).catch(() => {})
  }
}
