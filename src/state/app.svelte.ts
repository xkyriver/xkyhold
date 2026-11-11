// The app's state and the actions the screens call. Screens never touch
// the engine or Google Drive directly.

import { AuthError, googleAuth } from '../auth/google'
import { backup, FileReadError } from '../engine/backup'
import { AuthenticationError, FormatError, WrongKeyError } from '../engine/crypto'
import type { Credential, RepoKeys } from '../engine/crypto'
import { MissingBlobError, Repository } from '../engine/repo'
import type { Snapshot, TreeEntry } from '../engine/repo'
import { restoreEntries } from '../engine/restore'
import type { RestoreTarget } from '../engine/restore'
import { checkPermission, listFolders, requestPermission } from '../fs/folders'
import type { SavedFolder } from '../fs/folders'
import type { PermissionState } from '../fs/handles'
import { FolderTarget, VerifyTarget } from '../fs/restore-target'
import { detectCapabilities } from '../lib/capabilities'
import { formatBytes } from '../lib/format'
import { t } from '../lib/i18n.svelte'
import { NotFoundError } from '../storage/destination'
import { Drive, DriveError } from '../storage/drive'
import { DriveDestination } from '../storage/drive-destination'
import { clearStore, settings } from './db'

export type View = 'home' | 'restore' | 'settings'
export type JobKind = 'backup' | 'restore' | 'check'

export interface Job {
  kind: JobKind
  files: number
  bytes: number
  current: string
}

export interface FolderStatus {
  folder: SavedFolder
  permission: PermissionState
}

/** What is remembered on this device. The keys cannot be exported. */
interface SavedSetup {
  repoName: string
  account: string | null
  keys: RepoKeys
}

export const caps = detectCapabilities()

export const app = $state({
  /** False until the saved setup has been read. */
  ready: false,
  view: 'home' as View,
  /** A backup is set up on this device. */
  configured: false,
  repoName: '',
  account: null as string | null,
  /** There is a usable Google session. */
  connected: false,
  /** The backup in Drive is open and its history loaded. */
  loaded: false,
  opening: false,
  snapshots: [] as Snapshot[],
  folders: [] as FolderStatus[],
  job: null as Job | null,
  notice: null as string | null,
  error: null as string | null,
})

const drive = new Drive()
let keys: RepoKeys | null = null
let repo: Repository | null = null
let abort: AbortController | null = null

// --- Errors ---------------------------------------------------------------

const sessionExpired = (err: unknown) => err instanceof AuthError || (err instanceof DriveError && err.needsSignIn)

/** A sentence for the user. The raw error goes to the console. */
export function explain(err: unknown): string {
  console.error(err)
  if (err instanceof WrongKeyError) return t('That is not the right password or recovery key.')
  if (sessionExpired(err)) return t('Your Google session expired.')
  if (err instanceof FormatError) return err.message
  if (err instanceof AuthenticationError || err instanceof MissingBlobError) {
    return t('Part of this backup is damaged or missing in Google Drive.')
  }
  if (err instanceof FileReadError) return t('A folder could not be read. Check that it still exists.')
  if (err instanceof DriveError && err.status === 403) return t('Google Drive refused the request. Your Drive may be full.')
  if (err instanceof TypeError || (err instanceof DriveError && err.transient)) {
    return t('Could not reach Google Drive. Check your connection and try again.')
  }
  if (err instanceof DOMException && err.name === 'AbortError') return t('Stopped.')
  return t('Something went wrong. Please try again.')
}

function noteSession(err: unknown): void {
  if (!sessionExpired(err)) return
  googleAuth.invalidate()
  app.connected = false
}

// --- Google session -------------------------------------------------------

async function token(): Promise<string> {
  const current = googleAuth.current()
  if (!current) throw new AuthError('interaction_required', 'Google session expired')
  return current.accessToken
}

async function whoAmI(): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${await token()}` },
  })
  if (!res.ok) return null
  return (await res.json()).user?.emailAddress ?? null
}

/** Opens Google's window. Must be called from a click. */
export async function signIn(): Promise<boolean> {
  app.error = null
  try {
    await googleAuth.signIn(app.account ?? undefined)
    app.connected = true
    app.account = (await whoAmI()) ?? app.account
    if (app.configured) void openBackup()
    return true
  } catch (err) {
    if (err instanceof AuthError && err.code === 'cancelled') return false
    app.error =
      err instanceof AuthError && err.code === 'interaction_required'
        ? t('Your browser blocked the Google window. Allow pop-ups for this site and try again.')
        : t('Could not sign in to Google. Please try again.')
    console.error(err)
    return false
  }
}

// --- Start-up -------------------------------------------------------------

export async function start(): Promise<void> {
  try {
    const saved = await settings.get<SavedSetup>('setup')
    if (saved) {
      keys = saved.keys
      app.repoName = saved.repoName
      app.account = saved.account
      app.configured = true
    }
    app.connected = googleAuth.current() !== null
    await refreshFolders()
  } catch (err) {
    console.error(err)
  }
  app.ready = true
  if (app.configured && app.connected) void openBackup()
}

export async function refreshFolders(): Promise<void> {
  if (!caps.folderAccess) return
  const out: FolderStatus[] = []
  for (const folder of await listFolders()) out.push({ folder, permission: await checkPermission(folder) })
  app.folders = out
}

/** Asks again for folders that lost their permission. From a click. */
export async function allowFolders(): Promise<void> {
  for (const status of app.folders) {
    if (status.permission !== 'granted') await requestPermission(status.folder)
  }
  await refreshFolders()
}

// --- Setting up (used by the wizard) --------------------------------------

export async function listBackups(): Promise<string[]> {
  return (await DriveDestination.listRepositories(drive, token)).map((r) => r.name).sort()
}

async function remember(repoName: string, opened: Repository): Promise<void> {
  keys = opened.keys
  repo = opened
  await settings.set('setup', { repoName, account: app.account, keys } satisfies SavedSetup)
  app.repoName = repoName
  app.configured = true
}

/** Creates a new backup in Drive. Returns the recovery key, shown once. */
export async function createBackup(repoName: string, password: string): Promise<string> {
  const dest = await DriveDestination.forName(drive, token, repoName)
  let exists = true
  try {
    await Repository.readConfig(dest)
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
    exists = false
  }
  if (exists) throw new FormatError(t('A backup with this name already exists. Choose another name.'))
  const created = await Repository.create(dest, password)
  await remember(repoName, created.repo)
  app.snapshots = []
  app.loaded = true
  return created.recoveryKey
}

/** Connects this device to a backup that already exists in Drive. */
export async function connectBackup(repoName: string, credential: Credential): Promise<void> {
  const dest = await DriveDestination.forName(drive, token, repoName)
  const opened = await Repository.open(dest, credential)
  const snapshots = await opened.listSnapshots()
  await remember(repoName, opened)
  app.snapshots = snapshots
  app.loaded = true
}

async function openBackup(): Promise<void> {
  if (!keys || app.opening || app.loaded) return
  app.opening = true
  app.error = null
  try {
    const dest = await DriveDestination.forName(drive, token, app.repoName)
    const opened = new Repository(dest, keys)
    await opened.loadIndex()
    app.snapshots = await opened.listSnapshots()
    repo = opened
    app.loaded = true
  } catch (err) {
    noteSession(err)
    app.error = explain(err)
  } finally {
    app.opening = false
  }
}

export const retryOpen = () => openBackup()

// --- Jobs -----------------------------------------------------------------

async function runJob(kind: JobKind, work: (signal: AbortSignal, progress: (j: Omit<Job, 'kind'>) => void) => Promise<void>) {
  if (app.job || !repo) return
  app.job = { kind, files: 0, bytes: 0, current: '' }
  app.notice = null
  app.error = null
  abort = new AbortController()
  try {
    await work(abort.signal, (j) => (app.job = { kind, ...j }))
  } catch (err) {
    noteSession(err)
    app.error = abort.signal.aborted ? t('Stopped.') : explain(err)
  } finally {
    app.job = null
    abort = null
  }
}

export const stopJob = () => abort?.abort()

export async function backupNow(): Promise<void> {
  await refreshFolders()
  if (app.folders.length === 0) {
    app.error = t('Choose at least one folder to save, in Settings.')
    return
  }
  if (app.folders.some((f) => f.permission !== 'granted')) {
    app.error = t('XkyHold needs your permission to read your folders again.')
    return
  }
  const roots = app.folders.map(({ folder }) => ({ name: folder.name, handle: folder.handle }))
  await runJob('backup', async (signal, progress) => {
    const before = repo!.uploadedBytes
    const snapshot = await backup(repo!, roots, {
      device: app.repoName,
      parent: $state.snapshot(app.snapshots.at(-1)) ?? null,
      signal,
      onProgress: (p) => progress({ files: p.files, bytes: p.bytes, current: p.current }),
    })
    app.snapshots = [...app.snapshots, snapshot]
    const sent = formatBytes(repo!.uploadedBytes - before)
    app.notice =
      t('Backup complete: {files} files, {sent} sent to Google Drive.', {
        files: snapshot.stats.files.toLocaleString(),
        sent,
      }) + (snapshot.stats.skipped ? ` ${t('{n} could not be read.', { n: snapshot.stats.skipped })}` : '')
  })
}

export function loadTree(tree: string): Promise<TreeEntry[]> {
  return repo!.loadTree(tree)
}

async function restoreInto(entries: TreeEntry[], target: RestoreTarget, kind: JobKind, done: (files: number, bytes: number) => string) {
  await runJob(kind, async (signal, progress) => {
    const total = await restoreEntries(repo!, entries, target, {
      signal,
      onProgress: (p) => progress({ files: p.files, bytes: p.bytes, current: p.current }),
    })
    app.notice = done(total.files, total.bytes)
  })
}

/** Asks where to restore to, then restores. Must be called from a click. */
export async function restoreToFolder(entries: TreeEntry[]): Promise<void> {
  let target: FolderTarget | null
  try {
    target = await FolderTarget.pick()
  } catch (err) {
    app.error = explain(err)
    return
  }
  if (!target) return
  await restoreInto($state.snapshot(entries) as TreeEntry[], target, 'restore', (files, bytes) =>
    t('Restored {files} files ({size}).', { files: files.toLocaleString(), size: formatBytes(bytes) }),
  )
}

/** Downloads and verifies every file of a backup without writing anything. */
export async function checkSnapshot(snapshot: Snapshot): Promise<void> {
  const entries: TreeEntry[] = snapshot.roots.map((r) => ({ name: r.name, type: 'dir', subtree: r.tree }))
  await restoreInto(entries, new VerifyTarget(), 'check', (files, bytes) =>
    t('Checked {files} files ({size}): every one is intact.', { files: files.toLocaleString(), size: formatBytes(bytes) }),
  )
}

// --- Settings -------------------------------------------------------------

export async function changePassword(credential: Credential, newPassword: string): Promise<void> {
  const dest = await DriveDestination.forName(drive, token, app.repoName)
  await Repository.changePassword(dest, credential, newPassword)
}

/** Signs out of Google on this device. The backup stays set up. */
export async function disconnect(): Promise<void> {
  await googleAuth.signOut().catch(console.error)
  app.connected = false
  app.loaded = false
  repo = null
}

/** Removes everything XkyHold keeps in this browser. Drive is untouched. */
export async function forgetDevice(): Promise<void> {
  stopJob()
  await googleAuth.signOut().catch(console.error)
  await clearStore('settings')
  await clearStore('folders')
  keys = null
  repo = null
  Object.assign(app, {
    view: 'home',
    configured: false,
    repoName: '',
    account: null,
    connected: false,
    loaded: false,
    snapshots: [],
    folders: [],
    notice: null,
    error: null,
  })
}

export function defaultBackupName(): string {
  const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
  return platform ? t('{platform} computer', { platform }) : t('My computer')
}
