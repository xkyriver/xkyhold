// The app's state and the actions the screens call. Screens never touch
// the engine or Google Drive directly.

import { AuthError, googleAuth } from '../auth/google'
import { EngineClient, workerTransport } from '../engine/client'
import type { Credential, RepoKeys } from '../engine/crypto'
import { EngineError } from '../engine/errors'
import type { Progress } from '../engine/host'
import type { Snapshot, TreeEntry } from '../engine/repo'
import { checkPermission, listFolders, pickRestoreFolder, requestPermission } from '../fs/folders'
import type { SavedFolder } from '../fs/folders'
import type { PermissionState } from '../fs/handles'
import { detectCapabilities } from '../lib/capabilities'
import { formatBytes } from '../lib/format'
import { t } from '../lib/i18n.svelte'
import { DEFAULT_KEEP_MONTHS, DEFAULT_REMINDER_DAYS } from '../lib/reminder'
import { clearStore, settings } from './db'

export type View = 'home' | 'restore' | 'settings'
export type JobKind = 'backup' | 'restore' | 'check'

export interface Job {
  kind: JobKind
  files: number
  bytes: number
  current: string
  /** Old backups are being removed after a backup. */
  cleaning?: boolean
}

/** What is known about the latest backup without asking Google Drive. */
export interface LastBackup {
  time: string
  files: number
  bytes: number
  skipped: number
}

/** Choices the user makes in Settings, kept on this device. */
interface Preferences {
  remindDays: number
  keepMonths: number
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
  /** The latest backup as last seen on this device; known before connecting. */
  lastBackup: null as LastBackup | null,
  folders: [] as FolderStatus[],
  job: null as Job | null,
  /** Remind to back up after this many days; 0 never reminds. */
  remindDays: DEFAULT_REMINDER_DAYS,
  /** Remove backups older than this many months; 0 keeps them all. */
  keepMonths: DEFAULT_KEEP_MONTHS,
  /** The user said "not now" to the reminder during this visit. */
  reminderDismissed: false,
  notice: null as string | null,
  error: null as string | null,
})

/** The backup engine, in its own thread so the page never freezes. */
const engine = new EngineClient(
  workerTransport(new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' })),
)
let keys: RepoKeys | null = null
let abort: AbortController | null = null

/** Takes the history from the engine and remembers its latest entry. */
function setSnapshots(snapshots: Snapshot[]): void {
  app.snapshots = snapshots
  const last = snapshots.at(-1)
  app.lastBackup = last ? { time: last.time, ...last.stats } : null
  void settings.set('lastBackup', $state.snapshot(app.lastBackup)).catch(console.error)
}

/** Gives the engine the current Google token, or tells it there is none. */
function shareToken(): void {
  const current = googleAuth.current()
  engine.setToken(current?.accessToken ?? null)
  app.connected = current !== null
}

// --- Errors ---------------------------------------------------------------

const sessionExpired = (err: unknown) => err instanceof AuthError || (err instanceof EngineError && err.kind === 'session')

/** A sentence for the user. The raw error goes to the console. */
export function explain(err: unknown): string {
  console.error(err)
  if (err instanceof AuthError) return t('Your Google session expired.')
  if (!(err instanceof EngineError)) return t('Something went wrong. Please try again.')
  switch (err.kind) {
    case 'wrong-key':
      return t('That is not the right password or recovery key.')
    case 'session':
      return t('Your Google session expired.')
    case 'format':
      return t('This is not an XkyHold backup, or it was made by a newer version.')
    case 'exists':
      return t('A backup with this name already exists. Choose another name.')
    case 'damaged':
      return t('Part of this backup is damaged or missing in Google Drive.')
    case 'read':
      return t('A folder could not be read. Check that it still exists.')
    case 'busy':
      return t('Another device is using this backup right now. Try again in a few minutes.')
    case 'refused':
      return t('Google Drive refused the request. Your Drive may be full.')
    case 'network':
      return t('Could not reach Google Drive. Check your connection and try again.')
    case 'aborted':
      return t('Stopped.')
    default:
      return t('Something went wrong. Please try again.')
  }
}

function noteSession(err: unknown): void {
  if (!sessionExpired(err)) return
  googleAuth.invalidate()
  shareToken()
}

// --- Google session -------------------------------------------------------

async function whoAmI(): Promise<string | null> {
  const current = googleAuth.current()
  if (!current) return null
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${current.accessToken}` },
  })
  if (!res.ok) return null
  return (await res.json()).user?.emailAddress ?? null
}

/** Opens Google's window. Must be called from a click. */
export async function signIn(): Promise<boolean> {
  app.error = null
  try {
    await googleAuth.signIn(app.account ?? undefined)
    shareToken()
    app.account = (await whoAmI()) ?? app.account
    if (app.configured) await openBackup()
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
    app.lastBackup = (await settings.get<LastBackup>('lastBackup')) ?? null
    const prefs = await settings.get<Preferences>('preferences')
    if (prefs) {
      app.remindDays = prefs.remindDays
      app.keepMonths = prefs.keepMonths
    }
    shareToken()
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

export const listBackups = () => engine.call('listBackups', undefined)

async function remember(repoName: string, repoKeys: RepoKeys, snapshots: Snapshot[]): Promise<void> {
  keys = repoKeys
  await settings.set('setup', { repoName, account: app.account, keys } satisfies SavedSetup)
  app.repoName = repoName
  setSnapshots(snapshots)
  app.configured = true
  app.loaded = true
}

/** Creates a new backup in Drive. Returns the recovery key, shown once. */
export async function createBackup(repoName: string, password: string): Promise<string> {
  const created = await engine.call('create', { repoName, password })
  await remember(repoName, created.keys, [])
  return created.recoveryKey
}

/** Connects this device to a backup that already exists in Drive. */
export async function connectBackup(repoName: string, credential: Credential): Promise<void> {
  const connected = await engine.call('connect', { repoName, credential })
  await remember(repoName, connected.keys, connected.snapshots)
}

async function openBackup(): Promise<void> {
  if (!keys || app.opening || app.loaded) return
  app.opening = true
  app.error = null
  try {
    setSnapshots((await engine.call('open', { repoName: app.repoName, keys })).snapshots)
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

async function runJob(kind: JobKind, work: (job: { signal: AbortSignal; onProgress: (p: Progress) => void }) => Promise<void>) {
  if (app.job || !app.loaded) return
  app.job = { kind, files: 0, bytes: 0, current: '' }
  app.notice = null
  app.error = null
  abort = new AbortController()
  try {
    await work({ signal: abort.signal, onProgress: (p) => (app.job = { kind, ...p }) })
  } catch (err) {
    noteSession(err)
    app.error = explain(err)
  } finally {
    app.job = null
    abort = null
  }
}

export const stopJob = () => abort?.abort()

/** Backs up now. From a click: it may need to open Google's window first. */
export async function backupNow(): Promise<void> {
  if (app.job) return
  if (!app.loaded) {
    if (app.connected) await openBackup()
    else if (!(await signIn())) return
    if (!app.loaded) return
  }
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
  await runJob('backup', async (job) => {
    const done = await engine.call('backup', { roots, device: app.repoName, keepMonths: app.keepMonths }, job)
    const { snapshot } = done
    setSnapshots(done.snapshots)
    app.notice = [
      t('Backup complete: {files} files, {sent} sent to Google Drive.', {
        files: snapshot.stats.files.toLocaleString(),
        sent: formatBytes(done.sentBytes),
      }),
      snapshot.stats.skipped ? t('{n} could not be read.', { n: snapshot.stats.skipped }) : '',
      done.removed ? t('{n} old backups removed.', { n: done.removed }) : '',
    ]
      .filter(Boolean)
      .join(' ')
  })
}

export const loadTree = (tree: string): Promise<TreeEntry[]> => engine.call('loadTree', { tree })

/** Asks where to restore to, then restores. Must be called from a click. */
export async function restoreToFolder(entries: TreeEntry[]): Promise<void> {
  let folder: unknown
  try {
    folder = await pickRestoreFolder()
  } catch (err) {
    console.error(err)
    app.error = t('That folder cannot be used. Choose a folder such as Documents or Pictures.')
    return
  }
  if (!folder) return
  const plain = $state.snapshot(entries) as TreeEntry[]
  await runJob('restore', async (job) => {
    const done = await engine.call('restore', { entries: plain, folder }, job)
    app.notice = t('Restored {files} files ({size}).', { files: done.files.toLocaleString(), size: formatBytes(done.bytes) })
  })
}

/** Downloads and verifies every file of a backup without writing anything. */
export async function checkSnapshot(snapshot: Snapshot): Promise<void> {
  const entries: TreeEntry[] = snapshot.roots.map((r) => ({ name: r.name, type: 'dir', subtree: r.tree }))
  await runJob('check', async (job) => {
    const done = await engine.call('check', { entries }, job)
    app.notice = t('Checked {files} files ({size}): every one is intact.', {
      files: done.files.toLocaleString(),
      size: formatBytes(done.bytes),
    })
  })
}

// --- Settings -------------------------------------------------------------

export async function savePreferences(change: Partial<Preferences>): Promise<void> {
  Object.assign(app, change)
  await settings.set('preferences', { remindDays: app.remindDays, keepMonths: app.keepMonths } satisfies Preferences)
}

export const changePassword = (credential: Credential, newPassword: string): Promise<void> =>
  engine.call('changePassword', { repoName: app.repoName, credential, newPassword })

/** Signs out of Google on this device. The backup stays set up. */
export async function disconnect(): Promise<void> {
  await googleAuth.signOut().catch(console.error)
  shareToken()
  await engine.call('close', undefined)
  app.loaded = false
}

/** Removes everything XkyHold keeps in this browser. Drive is untouched. */
export async function forgetDevice(): Promise<void> {
  stopJob()
  await googleAuth.signOut().catch(console.error)
  shareToken()
  await engine.call('close', undefined)
  await clearStore('settings')
  await clearStore('folders')
  keys = null
  Object.assign(app, {
    view: 'home',
    configured: false,
    repoName: '',
    account: null,
    connected: false,
    loaded: false,
    snapshots: [],
    lastBackup: null,
    folders: [],
    remindDays: DEFAULT_REMINDER_DAYS,
    keepMonths: DEFAULT_KEEP_MONTHS,
    reminderDismissed: false,
    notice: null,
    error: null,
  })
}

export function defaultBackupName(): string {
  const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
  return platform ? t('{platform} computer', { platform }) : t('My computer')
}
