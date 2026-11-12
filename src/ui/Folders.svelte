<script lang="ts">
  import { addFolder, removeFolder, requestPermission } from '../fs/folders'
  import { scanFolder } from '../fs/scan'
  import type { ScanResult } from '../fs/scan'
  import { formatBytes } from '../lib/format'
  import { fileCount, t } from '../lib/i18n.svelte'
  import { app, refreshFolders } from '../state/app.svelte'
  import type { FolderStatus } from '../state/app.svelte'

  /** Sizes are counted once per folder and kept while the page is open. */
  let scans = $state<Record<string, ScanResult | undefined>>({})
  let error = $state<string | null>(null)
  const started = new Set<string>()

  $effect(() => {
    for (const { folder, permission } of app.folders) {
      if (permission !== 'granted' || started.has(folder.id)) continue
      started.add(folder.id)
      scanFolder(folder.handle, { onProgress: (r) => (scans[folder.id] = r) }).catch(() => started.delete(folder.id))
    }
  })

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
        </div>
        {#if status.permission !== 'granted'}
          <button class="link" onclick={() => allow(status)}>{t('Allow')}</button>
        {/if}
        <button class="link" onclick={() => remove(status)} aria-label={t('Remove {name}', { name: status.folder.name })}>
          {t('Remove')}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<div><button class="btn" onclick={add}>{t('Add folder…')}</button></div>
{#if error}<p class="small" style:color="var(--warn)" role="alert">{error}</p>{/if}
