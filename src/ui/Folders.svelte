<script lang="ts">
  import {
    addFiles,
    addFolder,
    canPickFiles,
    clashes,
    removeFolder,
    removeGroup,
    requestPermission,
    setLeftOut,
  } from '../fs/folders'
  import { scanFile, scanFolder } from '../fs/scan'
  import type { ScanResult } from '../fs/scan'
  import { formatBytes } from '../lib/format'
  import { fileCount, t } from '../lib/i18n.svelte'
  import { app, refreshFolders } from '../state/app.svelte'
  import type { FolderStatus } from '../state/app.svelte'
  import DropZone from './DropZone.svelte'
  import LeaveOut from './LeaveOut.svelte'

  /** Sizes are counted once per folder and kept while the page is open. */
  let scans = $state<Record<string, ScanResult | undefined>>({})
  let error = $state<string | null>(null)
  /** The folder whose sub-folders are being chosen, if any. */
  let choosing = $state<string | null>(null)
  const started = new Set<string>()
  /** Bumped when a folder's left-out list changes, so a stale count is ignored. */
  const generation: Record<string, number> = {}

  /** Folders made in XkyHold that are open, and new ones that hold nothing yet. */
  let open = $state<string[]>([])
  let fresh = $state<string[]>([])
  let naming = $state(false)
  let newName = $state('')
  let nameError = $state<string | null>(null)

  const byName = (a: FolderStatus, b: FolderStatus) => a.folder.name.localeCompare(b.folder.name)
  const loose = $derived(app.folders.filter((f) => !f.folder.group).sort(byName))
  const groups = $derived.by(() => {
    const names = [...new Set(app.folders.map((f) => f.folder.group).filter((g): g is string => !!g))]
    for (const name of fresh) if (!names.includes(name)) names.push(name)
    return names
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, members: app.folders.filter((f) => f.folder.group === name).sort(byName) }))
  })

  function count(status: FolderStatus) {
    const { folder } = status
    const gen = (generation[folder.id] = (generation[folder.id] ?? 0) + 1)
    started.add(folder.id)
    const report = (r: ScanResult) => {
      if (generation[folder.id] === gen) scans[folder.id] = r
    }
    const counting =
      folder.handle.kind === 'file'
        ? scanFile(folder.handle).then(report)
        : scanFolder(folder.handle, { leaveOut: [...(folder.leaveOut ?? [])], onProgress: report })
    counting.catch(() => started.delete(folder.id))
  }

  $effect(() => {
    for (const status of app.folders) {
      if (status.permission !== 'granted' || started.has(status.folder.id)) continue
      count(status)
    }
  })

  /** "12 folders · 3,402 files · 1.2 GB", once everything in it is counted. */
  function summary(members: FolderStatus[]): string {
    if (members.length === 0) return t('Empty')
    const dirs = members.filter((m) => m.folder.handle.kind === 'directory').length
    const parts = dirs === 0 ? [] : [dirs === 1 ? t('1 folder') : t('{n} folders', { n: dirs })]
    const counted = members.map((m) => scans[m.folder.id])
    if (counted.some((c) => !c)) {
      const loose = members.length - dirs
      if (loose > 0) parts.push(fileCount(loose))
      return parts.join(' · ')
    }
    const files = counted.reduce((sum, c) => sum + c!.files, 0)
    const bytes = counted.reduce((sum, c) => sum + c!.bytes, 0)
    return [...parts, fileCount(files), formatBytes(bytes)].join(' · ')
  }

  async function leaveOut(id: string, path: string, out: boolean) {
    await setLeftOut(id, path, out)
    await refreshFolders()
    const status = app.folders.find((f) => f.folder.id === id)
    if (status) {
      scans[id] = undefined
      count(status)
    }
  }

  async function add(group?: string) {
    error = null
    try {
      const result = await addFolder(group)
      if (result === 'clash') error = t('1 item was not added because there is already one with the same name.')
      await refreshFolders()
    } catch (err) {
      console.error(err)
      error = t('That folder cannot be used. Choose another one, such as a folder inside Documents.')
    }
  }

  async function pickFiles(group: string) {
    error = null
    try {
      const result = await addFiles(group)
      if (result?.clashed === 1) error = t('1 item was not added because there is already one with the same name.')
      else if (result?.clashed)
        error = t('{n} items were not added because there are already others with the same names.', { n: result.clashed })
      await refreshFolders()
    } catch (err) {
      console.error(err)
      error = t('Those files cannot be used.')
    }
  }

  function createGroup() {
    const name = newName.trim()
    nameError = null
    if (!name || name.includes('/')) {
      nameError = t('Write a name without “/”.')
      return
    }
    if (groups.some((g) => g.name === name)) {
      // Already there: just open it.
    } else if (clashes(app.folders.map((f) => f.folder), name)) {
      nameError = t('There is already a folder called {name}.', { name })
      return
    } else {
      fresh = [...fresh, name]
    }
    open = [...open.filter((g) => g !== name), name]
    naming = false
    newName = ''
  }

  function toggle(name: string) {
    open = open.includes(name) ? open.filter((g) => g !== name) : [...open, name]
  }

  async function dropGroup(name: string) {
    await removeGroup(name)
    fresh = fresh.filter((g) => g !== name)
    open = open.filter((g) => g !== name)
    await refreshFolders()
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

{#snippet row(status: FolderStatus)}
  {@const scan = scans[status.folder.id]}
  <li>
    <div class="grow">
      <div><strong>{status.folder.name}</strong></div>
      <div class="small muted">
        {#if status.permission !== 'granted'}
          {t('Needs your permission to be read')}
        {:else if scan && status.folder.handle.kind === 'file'}
          {t('File')} · {formatBytes(scan.bytes)}
        {:else if scan}
          {fileCount(scan.files)} · {formatBytes(scan.bytes)}
        {:else}
          {t('Counting files…')}
        {/if}
      </div>
      {#if status.folder.leaveOut?.length}
        <div class="small muted">
          {t('Left out: {list}', { list: status.folder.leaveOut.map((p) => p.replaceAll('/', ' / ')).join(', ') })}
        </div>
      {/if}
    </div>
    {#if status.permission !== 'granted'}
      <button class="link" onclick={() => allow(status)}>{t('Allow')}</button>
    {:else if choosing !== status.folder.id && status.folder.handle.kind === 'directory'}
      <button class="link" onclick={() => (choosing = status.folder.id)}>{t('Leave out…')}</button>
    {/if}
    <button class="link" onclick={() => remove(status)} aria-label={t('Remove {name}', { name: status.folder.name })}>
      {t('Remove')}
    </button>
  </li>
  {#if choosing === status.folder.id && status.permission === 'granted' && status.folder.handle.kind === 'directory'}
    <li class="chooser">
      <LeaveOut
        root={status.folder.handle}
        leftOut={status.folder.leaveOut ?? []}
        change={(path, out) => leaveOut(status.folder.id, path, out)}
        close={() => (choosing = null)}
      />
    </li>
  {/if}
{/snippet}

{#if app.folders.length === 0 && groups.length === 0}
  <p class="muted small">{t('No folders chosen yet.')}</p>
{/if}

{#each groups as group (group.name)}
  {@const isOpen = open.includes(group.name)}
  <div class="group">
    <div class="group-head">
      <button class="group-toggle" aria-expanded={isOpen} onclick={() => toggle(group.name)}>
        <span class="chevron" class:turned={isOpen} aria-hidden="true">›</span>
        <span class="grow">
          <strong>{group.name}</strong>
          <span class="small muted block">{summary(group.members)}</span>
        </span>
      </button>
      <button class="link" onclick={() => dropGroup(group.name)} aria-label={t('Remove {name}', { name: group.name })}>
        {t('Remove')}
      </button>
    </div>
    {#if isOpen}
      <div class="group-body stack">
        <p class="small muted">{t('It only exists in your backup: nothing changes on your computer.')}</p>
        {#if group.members.length > 0}
          <ul class="list">
            {#each group.members as status (status.folder.id)}
              {@render row(status)}
            {/each}
          </ul>
        {/if}
        <div class="row">
          <button class="btn" onclick={() => add(group.name)}>{t('Add folder…')}</button>
          {#if canPickFiles()}
            <button class="btn" onclick={() => pickFiles(group.name)}>{t('Add files…')}</button>
          {/if}
        </div>
        <DropZone
          group={group.name}
          hint={t('Or drag folders or files into {name} from your file manager.', { name: group.name })}
        />
        <p class="small muted">
          {t('New folders and files next to the ones you chose are not added by themselves. To have them saved, keep them inside one of the folders you chose.')}
        </p>
      </div>
    {/if}
  </div>
{/each}

{#if loose.length > 0}
  <ul class="list">
    {#each loose as status (status.folder.id)}
      {@render row(status)}
    {/each}
  </ul>
{/if}

<div class="row">
  <button class="btn" onclick={() => add()}>{t('Add folder…')}</button>
  {#if !naming}
    <button class="btn" onclick={() => (naming = true)}>{t('New folder…')}</button>
  {/if}
</div>

{#if naming}
  <form
    class="new-group stack"
    onsubmit={(e) => {
      e.preventDefault()
      createGroup()
    }}
  >
    <label for="group-name">{t('Folder name')}</label>
    <input id="group-name" type="text" bind:value={newName} placeholder={t('For example, Documents')} autocomplete="off" />
    <p class="small muted">
      {t('Put several folders together in your backup. It only exists in your backup: nothing changes on your computer.')}
    </p>
    {#if nameError}<p class="small" style:color="var(--warn)" role="alert">{nameError}</p>{/if}
    <div class="row">
      <button class="btn primary" type="submit">{t('Create')}</button>
      <button class="btn" type="button" onclick={() => ((naming = false), (newName = ''), (nameError = null))}>
        {t('Cancel')}
      </button>
    </div>
  </form>
{/if}

<DropZone hint={t('Or drag folders here from your file manager. You can drag many at once.')} />
<p class="small muted">
  {t('Your browser does not let you choose some folders whole, such as your personal folder, Documents or Desktop, because they can contain system files. Choose the folders inside them instead.')}
</p>
{#if error}<p class="small" style:color="var(--warn)" role="alert">{error}</p>{/if}

<style>
  .chooser {
    display: block;
  }

  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
  }

  .group-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .chevron {
    font-size: 1.25rem;
    line-height: 1;
    color: var(--muted);
    transition: transform 0.15s;
  }

  .chevron.turned {
    transform: rotate(90deg);
  }

  .block {
    display: block;
  }

  .group-body {
    padding: 0 12px 12px;
  }

  .new-group {
    padding: 12px 14px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
</style>
