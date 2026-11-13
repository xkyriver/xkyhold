<script lang="ts">
  import { addFolder, removeFolder, requestPermission, setLeftOut } from '../fs/folders'
  import { scanFolder } from '../fs/scan'
  import type { ScanResult } from '../fs/scan'
  import { formatBytes } from '../lib/format'
  import { fileCount, t } from '../lib/i18n.svelte'
  import { app, refreshFolders } from '../state/app.svelte'
  import type { FolderStatus } from '../state/app.svelte'
  import LeaveOut from './LeaveOut.svelte'

  /** Sizes are counted once per folder and kept while the page is open. */
  let scans = $state<Record<string, ScanResult | undefined>>({})
  let error = $state<string | null>(null)
  /** The folder whose sub-folders are being chosen, if any. */
  let choosing = $state<string | null>(null)
  const started = new Set<string>()
  /** Bumped when a folder's left-out list changes, so a stale count is ignored. */
  const generation: Record<string, number> = {}

  function count(status: FolderStatus) {
    const { folder } = status
    const gen = (generation[folder.id] = (generation[folder.id] ?? 0) + 1)
    started.add(folder.id)
    const report = (r: ScanResult) => {
      if (generation[folder.id] === gen) scans[folder.id] = r
    }
    scanFolder(folder.handle, { leaveOut: [...(folder.leaveOut ?? [])], onProgress: report }).catch(() =>
      started.delete(folder.id),
    )
  }

  $effect(() => {
    for (const status of app.folders) {
      if (status.permission !== 'granted' || started.has(status.folder.id)) continue
      count(status)
    }
  })

  async function leaveOut(id: string, path: string, out: boolean) {
    await setLeftOut(id, path, out)
    await refreshFolders()
    const status = app.folders.find((f) => f.folder.id === id)
    if (status) {
      scans[id] = undefined
      count(status)
    }
  }

  async function add() {
    error = null
    try {
      await addFolder()
      await refreshFolders()
    } catch (err) {
      console.error(err)
      error = t('That folder cannot be used. Choose a folder such as Documents or Pictures.')
    }
  }

  async function allow(status: FolderStatus) {
    await requestPermission(status.folder)
    await refreshFolders()
  }

  async function remove(status: FolderStatus) {
    await removeFolder(status.folder.id)
    await refreshFolders()
  }
</script>

{#if app.folders.length === 0}
  <p class="muted small">{t('No folders chosen yet.')}</p>
{:else}
  <ul class="list">
    {#each app.folders as status (status.folder.id)}
      {@const scan = scans[status.folder.id]}
      <li>
        <div class="grow">
          <div><strong>{status.folder.name}</strong></div>
          <div class="small muted">
            {#if status.permission !== 'granted'}
              {t('Needs your permission to be read')}
            {:else if scan}
              {fileCount(scan.files)} · {formatBytes(scan.bytes)}
            {:else}
              {t('Counting files…')}
            {/if}
          </div>
          {#if status.folder.leaveOut?.length}
            <div class="small muted">{t('Left out: {list}', { list: status.folder.leaveOut.map((p) => p.replaceAll('/', ' / ')).join(', ') })}</div>
          {/if}
        </div>
        {#if status.permission !== 'granted'}
          <button class="link" onclick={() => allow(status)}>{t('Allow')}</button>
        {:else if choosing !== status.folder.id}
          <button class="link" onclick={() => (choosing = status.folder.id)}>{t('Leave out…')}</button>
        {/if}
        <button class="link" onclick={() => remove(status)} aria-label={t('Remove {name}', { name: status.folder.name })}>
          {t('Remove')}
        </button>
      </li>
      {#if choosing === status.folder.id && status.permission === 'granted'}
        <li class="chooser">
          <LeaveOut
            root={status.folder.handle}
            leftOut={status.folder.leaveOut ?? []}
            change={(path, out) => leaveOut(status.folder.id, path, out)}
            close={() => (choosing = null)}
          />
        </li>
      {/if}
    {/each}
  </ul>
{/if}

<div><button class="btn" onclick={add}>{t('Add folder…')}</button></div>
<p class="small muted">
  {t('Your browser does not let you choose your whole personal folder, because it contains system files. Choose the folders inside it, such as Documents or Pictures.')}
</p>
{#if error}<p class="small" style:color="var(--warn)" role="alert">{error}</p>{/if}

<style>
  .chooser {
    display: block;
  }
</style>
