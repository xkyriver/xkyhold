<script lang="ts">
  // First working version of the main flow: create or open a backup in
  // Google Drive, back up the chosen folders, verify and restore. The
  // layout is functional, not final.
  import { AuthError, googleAuth } from '../auth/google'
  import { backup } from '../engine/backup'
  import type { BackupProgress } from '../engine/backup'
  import { WrongKeyError } from '../engine/crypto'
  import { Repository } from '../engine/repo'
  import type { Snapshot } from '../engine/repo'
  import { restoreEntries } from '../engine/restore'
  import type { RestoreProgress } from '../engine/restore'
  import { checkPermission, listFolders } from '../fs/folders'
  import { FolderTarget, VerifyTarget } from '../fs/restore-target'
  import { formatBytes } from '../lib/format'
  import { NotFoundError } from '../storage/destination'
  import { Drive, DriveError } from '../storage/drive'
  import { DriveDestination } from '../storage/drive-destination'

  const NAME_KEY = 'xkyhold.repoName'
  const drive = new Drive()

  /** The session's token; never opens a popup on its own. */
  async function token(): Promise<string> {
    const current = googleAuth.current()
    if (!current) throw new AuthError('interaction_required', 'Google session expired')
    return current.accessToken
  }

  function defaultName(): string {
    const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
    return platform ? `${platform} computer` : 'My computer'
  }

  let name = $state(localStorage.getItem(NAME_KEY) ?? defaultName())
  // Development convenience: a throwaway password from .env.local.
  const prefill = import.meta.env.DEV ? (import.meta.env.VITE_TEST_REPO_PASSWORD ?? '') : ''
  let password = $state(prefill)
  let password2 = $state(prefill)
  let exists = $state<boolean | null>(null)
  let repo = $state.raw<Repository | null>(null)
  let recoveryKey = $state<string | null>(null)
  let snapshots = $state<Snapshot[]>([])
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let backupProgress = $state<BackupProgress | null>(null)
  let restoreProgress = $state<RestoreProgress | null>(null)

  /** The action to repeat once the user has signed in again. */
  let retry = $state.raw<(() => unknown) | null>(null)

  const sessionExpired = (err: unknown) => err instanceof AuthError || (err instanceof DriveError && err.needsSignIn)

  function explain(err: unknown): string {
    console.error(err)
    if (err instanceof WrongKeyError) return 'That password is not right.'
    if (sessionExpired(err)) return 'Your Google session expired.'
    if (err instanceof TypeError) return 'Could not reach Google Drive. Check your connection and try again.'
    return err instanceof Error ? err.message : 'Something went wrong.'
  }

  async function task<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
    busy = label
    error = null
    notice = null
    retry = null
    try {
      return await run()
    } catch (err) {
      error = explain(err)
      if (sessionExpired(err)) retry = () => task(label, run)
    } finally {
      busy = null
      backupProgress = null
      restoreProgress = null
    }
  }

  /** Runs from a click, so the browser lets Google's window open. */
  async function signInAndRetry() {
    const again = retry
    try {
      await googleAuth.signIn()
    } catch (err) {
      error = err instanceof AuthError && err.code === 'cancelled' ? 'Your Google session expired.' : explain(err)
      return
    }
    await again?.()
  }

  async function destination(): Promise<DriveDestination> {
    return DriveDestination.forName(drive, token, name.trim())
  }

  const look = () =>
    task('Looking for your backup…', async () => {
      const dest = await destination()
      try {
        await Repository.readConfig(dest)
        exists = true
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err
        exists = false
      }
      localStorage.setItem(NAME_KEY, name.trim())
    })

  const create = () =>
    task('Creating your backup…', async () => {
      const created = await Repository.create(await destination(), password)
      repo = created.repo
      recoveryKey = created.recoveryKey
      password = password2 = ''
    })

  const unlock = () =>
    task('Opening your backup…', async () => {
      const opened = await Repository.open(await destination(), { password })
      snapshots = await opened.listSnapshots()
      repo = opened
      password = ''
    })

  const backUp = () =>
    task('Backing up…', async () => {
      const roots = []
      for (const folder of await listFolders()) {
        if ((await checkPermission(folder)) !== 'granted') throw new Error(`Allow access to "${folder.name}" first.`)
        roots.push({ name: folder.name, handle: folder.handle })
      }
      if (roots.length === 0) throw new Error('Add a folder to save first.')
      const before = repo!.uploadedBytes
      const snapshot = await backup(repo!, roots, {
        device: name.trim(),
        parent: snapshots.at(-1) ?? null,
        onProgress: (p) => (backupProgress = p),
      })
      snapshots = [...snapshots, snapshot]
      const { files, bytes, skipped } = snapshot.stats
      notice =
        `Backed up ${files.toLocaleString()} files (${formatBytes(bytes)}); ` +
        `${formatBytes(repo!.uploadedBytes - before)} sent to Google Drive.` +
        (skipped ? ` ${skipped} could not be read.` : '')
    }).finally(() => (backupProgress = null))

  async function restoreInto(snapshot: Snapshot, target: FolderTarget | VerifyTarget): Promise<RestoreProgress> {
    const total: RestoreProgress = { files: 0, bytes: 0, current: '' }
    for (const root of snapshot.roots) {
      const entries = await repo!.loadTree(root.tree)
      await restoreEntries(repo!, entries, await target.createDir(root.name), { onProgress: (p) => (restoreProgress = p) }, total)
    }
    return total
  }

  const verify = (snapshot: Snapshot) =>
    task('Checking your backup…', async () => {
      const done = await restoreInto(snapshot, new VerifyTarget())
      notice = `Checked ${done.files.toLocaleString()} files (${formatBytes(done.bytes)}): every one is intact.`
    }).finally(() => (restoreProgress = null))

  const restore = (snapshot: Snapshot) =>
    task('Restoring…', async () => {
      const target = await FolderTarget.pick()
      if (!target) return
      const done = await restoreInto(snapshot, target)
      notice = `Restored ${done.files.toLocaleString()} files (${formatBytes(done.bytes)}).`
    }).finally(() => (restoreProgress = null))

  const when = (snapshot: Snapshot) => new Date(snapshot.time).toLocaleString()
</script>

<section class="backup">
  <h2>Backup</h2>

  {#if recoveryKey}
    <p>Your backup is ready. This is your <strong>recovery key</strong>. It opens your backup if you forget the password.</p>
    <p class="key">{recoveryKey}</p>
    <p class="hint warn">Print it or write it down and keep it away from this computer. It is shown only once.</p>
    <button class="primary" onclick={() => (recoveryKey = null)}>I have saved it</button>
  {:else if !repo}
    <label for="repo-name">Name of this backup in Google Drive</label>
    <input id="repo-name" bind:value={name} oninput={() => (exists = null)} autocomplete="off" spellcheck="false" />

    {#if exists === null}
      <button class="primary" onclick={look} disabled={!!busy || !name.trim()}>Continue</button>
    {:else if exists}
      <p class="hint">This backup already exists. Enter its password to open it.</p>
      <input type="password" bind:value={password} placeholder="Password" autocomplete="current-password" />
      <button class="primary" onclick={unlock} disabled={!!busy || !password}>Open backup</button>
    {:else}
      <p class="hint">Files are encrypted before they leave this computer. Choose a password to protect them.</p>
      <input type="password" bind:value={password} placeholder="Password" autocomplete="new-password" />
      <input type="password" bind:value={password2} placeholder="Confirm password" autocomplete="new-password" />
      <button class="primary" onclick={create} disabled={!!busy || !password || password !== password2}>Create backup</button>
    {/if}
  {:else}
    <button class="primary" onclick={backUp} disabled={!!busy}>Back up now</button>

    {#if snapshots.length > 0}
      <h3>Restore from…</h3>
      <ul>
        {#each [...snapshots].reverse() as snapshot (snapshot.id)}
          <li>
            <div class="info">
              <span>{when(snapshot)}</span>
              <span class="detail">{snapshot.stats.files.toLocaleString()} files · {formatBytes(snapshot.stats.bytes)}</span>
            </div>
            <button class="link" onclick={() => verify(snapshot)} disabled={!!busy}>Check</button>
            <button class="link" onclick={() => restore(snapshot)} disabled={!!busy}>Restore…</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">No backups yet.</p>
    {/if}
  {/if}

  {#if busy}
    <p class="hint" role="status">
      {busy}
      {#if backupProgress}
        {backupProgress.files.toLocaleString()} files · {formatBytes(backupProgress.bytes)}
      {:else if restoreProgress}
        {restoreProgress.files.toLocaleString()} files · {formatBytes(restoreProgress.bytes)}
      {/if}
    </p>
  {/if}
  {#if notice}<p class="hint ok" role="status">{notice}</p>{/if}
  {#if error}<p class="hint warn" role="alert">{error}</p>{/if}
  {#if retry && !busy}
    <button class="primary" onclick={signInAndRetry}>Sign in again and continue</button>
  {/if}
</section>

<style>
  .backup {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    text-align: left;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }

  h3 {
    margin: 20px 0 4px;
    font-size: 0.875rem;
    color: var(--muted);
  }

  label {
    display: block;
    margin-bottom: 4px;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  input {
    width: 100%;
    margin-bottom: 8px;
    padding: 10px 12px;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .key {
    padding: 12px;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.9375rem;
    line-height: 1.8;
    text-align: center;
    word-spacing: 0.25em;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    user-select: all;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .detail {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .hint.ok {
    color: var(--ok);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
