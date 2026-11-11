// The engine's side of the conversation with the page. It runs inside a
// Web Worker in the app, and in the same thread in tests: all it knows is
// messages in, messages out.

import type { DirHandleLike } from '../fs/handles'
import { FolderTarget, VerifyTarget } from '../fs/restore-target'
import type { WritableDir } from '../fs/restore-target'
import type { Destination } from '../storage/destination'
import { NotFoundError } from '../storage/destination'
import { backup } from './backup'
import type { Argon2Params, Credential, RepoKeys } from './crypto'
import { classify, EngineError } from './errors'
import type { SerializedError } from './errors'
import { Repository } from './repo'
import type { RepositoryOptions, Snapshot, TreeEntry } from './repo'
import { restoreEntries } from './restore'

export interface Progress {
  files: number
  bytes: number
  current: string
}

/** Every call the page can make, with its arguments and its result. */
export interface EngineApi {
  listBackups(args: void): string[]
  create(args: { repoName: string; password: string }): { recoveryKey: string; keys: RepoKeys }
  connect(args: { repoName: string; credential: Credential }): { keys: RepoKeys; snapshots: Snapshot[] }
  open(args: { repoName: string; keys: RepoKeys }): { snapshots: Snapshot[] }
  close(args: void): void
  backup(args: { roots: { name: string; handle: DirHandleLike }[]; device: string }): { snapshot: Snapshot; sentBytes: number }
  loadTree(args: { tree: string }): TreeEntry[]
  restore(args: { entries: TreeEntry[]; folder: unknown }): { files: number; bytes: number }
  check(args: { entries: TreeEntry[] }): { files: number; bytes: number }
  changePassword(args: { repoName: string; credential: Credential; newPassword: string }): void
}

export type Method = keyof EngineApi

export type Request =
  | { type: 'call'; id: number; method: Method; args: unknown }
  | { type: 'abort'; id: number }
  | { type: 'token'; token: string | null }

export type Response =
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; error: SerializedError }
  | { type: 'progress'; id: number; progress: Progress }

export interface HostEnvironment {
  /** The storage for the backup called `repoName`. */
  destination(repoName: string, token: () => Promise<string>): Promise<Destination & { warm?(): Promise<void> }>
  listBackups(token: () => Promise<string>): Promise<string[]>
  /** Test hooks: cheaper key derivation and smaller packs. */
  repository?: RepositoryOptions & { argon2?: Argon2Params }
}

export function createHost(env: HostEnvironment, post: (message: Response) => void): (message: Request) => void {
  let currentToken: string | null = null
  let repo: Repository | null = null
  let snapshots: Snapshot[] = []
  const running = new Map<number, AbortController>()

  const token = async () => {
    if (!currentToken) throw new EngineError('session', 'No Google session')
    return currentToken
  }

  const opened = (): Repository => {
    if (!repo) throw new EngineError('other', 'No backup is open')
    return repo
  }

  async function destination(repoName: string) {
    const dest = await env.destination(repoName, token)
    return dest
  }

  type Handler<M extends Method> = (
    args: Parameters<EngineApi[M]>[0],
    job: { signal: AbortSignal; progress: (p: Progress) => void },
  ) => Promise<ReturnType<EngineApi[M]>>

  const handlers: { [M in Method]: Handler<M> } = {
    listBackups: () => env.listBackups(token),

    async create({ repoName, password }) {
      const dest = await destination(repoName)
      let exists = true
      try {
        await Repository.readConfig(dest)
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err
        exists = false
      }
      if (exists) throw new EngineError('exists')
      const created = await Repository.create(dest, password, env.repository)
      repo = created.repo
      snapshots = []
      return { recoveryKey: created.recoveryKey, keys: repo.keys }
    },

    async connect({ repoName, credential }) {
      const dest = await destination(repoName)
      void dest.warm?.().catch(() => {})
      const connected = await Repository.open(dest, credential, env.repository)
      snapshots = await connected.listSnapshots()
      repo = connected
      return { keys: repo.keys, snapshots }
    },

    async open({ repoName, keys }) {
      const dest = await destination(repoName)
      void dest.warm?.().catch(() => {})
      const reopened = new Repository(dest, keys, env.repository)
      const [, listed] = await Promise.all([reopened.loadIndex(), reopened.listSnapshots()])
      snapshots = listed
      repo = reopened
      return { snapshots }
    },

    async close() {
      repo = null
      snapshots = []
    },

    async backup({ roots, device }, { signal, progress }) {
      const r = opened()
      const before = r.uploadedBytes
      const snapshot = await backup(r, roots, {
        device,
        parent: snapshots.at(-1) ?? null,
        signal,
        onProgress: (p) => progress({ files: p.files, bytes: p.bytes, current: p.current }),
      })
      snapshots = [...snapshots, snapshot]
      return { snapshot, sentBytes: r.uploadedBytes - before }
    },

    loadTree: ({ tree }) => opened().loadTree(tree),

    async restore({ entries, folder }, { signal, progress }) {
      const total = await restoreEntries(opened(), entries, new FolderTarget(folder as WritableDir), { signal, onProgress: progress })
      return { files: total.files, bytes: total.bytes }
    },

    async check({ entries }, { signal, progress }) {
      const total = await restoreEntries(opened(), entries, new VerifyTarget(), { signal, onProgress: progress })
      return { files: total.files, bytes: total.bytes }
    },

    async changePassword({ repoName, credential, newPassword }) {
      await Repository.changePassword(await destination(repoName), credential, newPassword, env.repository?.argon2)
    },
  }

  async function call(id: number, method: Method, args: unknown): Promise<void> {
    const controller = new AbortController()
    running.set(id, controller)
    try {
      const handler = handlers[method] as Handler<Method> | undefined
      if (!handler) throw new EngineError('other', `Unknown method ${method}`)
      const result = await handler(args as never, {
        signal: controller.signal,
        progress: (progress) => post({ type: 'progress', id, progress }),
      })
      post({ type: 'result', id, result })
    } catch (err) {
      post({ type: 'error', id, error: controller.signal.aborted ? { kind: 'aborted', message: 'Stopped' } : classify(err) })
    } finally {
      running.delete(id)
    }
  }

  return (message) => {
    if (message.type === 'token') currentToken = message.token
    else if (message.type === 'abort') running.get(message.id)?.abort()
    else void call(message.id, message.method, message.args)
  }
}
