<script lang="ts">
  // Pick a backup by date, browse its folders, tick what to bring back.
  import type { Snapshot, TreeEntry } from '../engine/repo'
  import { formatBytes } from '../lib/format'
  import { formatWhen, t } from '../lib/i18n.svelte'
  import { app, caps, checkSnapshot, explain, loadTree, restoreToFolder, stopJob } from '../state/app.svelte'

  interface Level {
    name: string
    entries: TreeEntry[]
  }

  let snapshot = $state.raw<Snapshot | null>(null)
  let path = $state.raw<Level[]>([])
  let ticked = $state<Record<string, boolean>>({})
  let loading = $state(false)
  let error = $state<string | null>(null)

  const newestFirst = $derived([...app.snapshots].reverse())
  const level = $derived(path.at(-1))
  const chosen = $derived(level ? level.entries.filter((e) => ticked[e.name]) : [])
  const working = $derived(app.job?.kind === 'restore' || app.job?.kind === 'check')

  function open(s: Snapshot) {
    snapshot = s
    ticked = {}
    // The chosen folders appear as the top level of the backup.
    path = [{ name: formatWhen(s.time), entries: s.roots.map((r) => ({ name: r.name, type: 'dir', subtree: r.tree })) }]
  }

  async function enter(entry: TreeEntry) {
    if (entry.type !== 'dir' || loading) return
    loading = true
    error = null
    try {
      const entries = await loadTree(entry.subtree)
      // Folders first, then files, each by name.
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      path = [...path, { name: entry.name, entries }]
      ticked = {}
    } catch (err) {
      error = explain(err)
    } finally {
      loading = false
    }
  }

  function goTo(index: number) {
    path = path.slice(0, index + 1)
    ticked = {}
  }

  function back() {
    if (path.length > 1) goTo(path.length - 2)
    else snapshot = null
  }

  const toggleAll = (on: boolean) => (ticked = on && level ? Object.fromEntries(level.entries.map((e) => [e.name, true])) : {})
</script>

{#if working && app.job}
  <section class="card center stack">
    <h1>{app.job.kind === 'check' ? t('Checking your backup…') : t('Restoring…')}</h1>
    <p class="muted">{t('{files} files', { files: app.job.files.toLocaleString() })} · {formatBytes(app.job.bytes)}</p>
    <p class="small muted current">{app.job.current || ' '}</p>
    <div><button class="btn" onclick={stopJob}>{t('Stop')}</button></div>
  </section>
{:else if !app.loaded}
  <section class="card stack">
    <h1>{t('Restore')}</h1>
    <p class="muted">{app.opening ? t('Opening your backup…') : t('Connect to Google Drive to back up or restore.')}</p>
  </section>
{:else if !snapshot}
  <section class="card stack">
    <h1>{t('Restore')}</h1>
    {#if newestFirst.length === 0}
      <p class="muted">{t('There is nothing to restore yet.')}</p>
    {:else}
      <p class="muted">{t('Pick a date to see what is inside.')}</p>
      <ul class="list">
        {#each newestFirst as s (s.id)}
          <li>
            <button class="pick grow" onclick={() => open(s)}>
              <strong>{formatWhen(s.time)}</strong>
              <span class="small muted">
                {t('{files} files', { files: s.stats.files.toLocaleString() })} · {formatBytes(s.stats.bytes)}
              </span>
            </button>
            <button class="link small" onclick={() => checkSnapshot(s)} disabled={!!app.job}>{t('Check')}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if level}
  <section class="card stack">
    <nav class="crumbs small" aria-label={t('Location')}>
      {#each path as crumb, i}
        {#if i > 0}<span class="muted">›</span>{/if}
        {#if i < path.length - 1}
          <button class="link" onclick={() => goTo(i)}>{crumb.name}</button>
        {:else}
          <strong>{crumb.name}</strong>
        {/if}
      {/each}
    </nav>

    {#if level.entries.length === 0}
      <p class="muted">{t('This folder is empty.')}</p>
    {:else}
      <div class="row between small">
        <span class="muted">{t('Tick the files and folders you want back.')}</span>
        <button class="link" onclick={() => toggleAll(chosen.length < level.entries.length)}>
          {chosen.length < level.entries.length ? t('Select all') : t('Select none')}
        </button>
      </div>
      <ul class="list">
        {#each level.entries as entry (entry.name)}
          <li>
            <input type="checkbox" bind:checked={ticked[entry.name]} aria-label={entry.name} />
            {#if entry.type === 'dir'}
              <button class="pick grow" onclick={() => enter(entry)} disabled={loading}>
                <span>📁 {entry.name}</span>
              </button>
              <span class="muted" aria-hidden="true">›</span>
            {:else}
              <span class="grow">{entry.name}</span>
              <span class="small muted">{formatBytes(entry.size)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if error}<div class="banner warn" role="alert"><span>{error}</span></div>{/if}

    <div class="row between">
      <button class="btn" onclick={back}>{t('Back')}</button>
      {#if caps.folderAccess}
        <button class="btn primary" onclick={() => restoreToFolder(chosen)} disabled={chosen.length === 0 || !!app.job}>
          {chosen.length === 0 ? t('Restore…') : t('Restore {n} selected…', { n: chosen.length })}
        </button>
      {/if}
    </div>
    {#if caps.folderAccess}
      <p class="small muted">{t('You will choose where to put them. Restored files get today’s date.')}</p>
    {:else}
      <p class="small muted">{t('Restoring is not available in this browser yet. Use Chrome or Edge on a computer.')}</p>
    {/if}
  </section>
{/if}

<style>
  .pick {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 2px 0;
    font: inherit;
    color: inherit;
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .pick:hover strong,
  .pick:hover span:first-child {
    color: var(--accent);
  }

  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
</style>
