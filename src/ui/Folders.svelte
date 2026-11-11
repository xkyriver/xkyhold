<script lang="ts">
  import { addFolder, checkPermission, listFolders, removeFolder, requestPermission } from '../fs/folders'
  import type { SavedFolder } from '../fs/folders'
  import type { PermissionState } from '../fs/handles'
  import { scanFolder } from '../fs/scan'
  import type { ScanResult } from '../fs/scan'
  import { formatBytes } from '../lib/format'

  interface Row {
    folder: SavedFolder
    permission: PermissionState
    scan: ScanResult | null
    scanning: boolean
  }

  let rows = $state<Row[]>([])
  let error = $state<string | null>(null)

  async function scan(row: Row) {
    row.scanning = true
    try {
      row.scan = await scanFolder(row.folder.handle, { onProgress: (r) => (row.scan = r) })
    } catch (err) {
      console.error(err)
      row.permission = 'denied'
    } finally {
      row.scanning = false
    }
  }

  async function track(folder: SavedFolder) {
    rows.push({ folder, permission: await checkPermission(folder), scan: null, scanning: false })
    const row = rows[rows.length - 1]
    if (row.permission === 'granted') void scan(row)
  }

  async function load() {
    try {
      for (const folder of await listFolders()) await track(folder)
    } catch (err) {
      console.error(err)
      error = 'Could not load your folders.'
    }
  }

  async function add() {
    error = null
    try {
      const folder = await addFolder()
      if (folder && !rows.some((r) => r.folder.id === folder.id)) await track(folder)
    } catch (err) {
      console.error(err)
      error = 'Could not add that folder.'
    }
  }

  async function allow(row: Row) {
    row.permission = await requestPermission(row.folder)
    if (row.permission === 'granted') void scan(row)
  }

  async function remove(row: Row) {
    await removeFolder(row.folder.id)
    rows = rows.filter((r) => r !== row)
  }

  void load()
</script>

<section class="folders">
  <h2>Folders to save</h2>

  {#if rows.length === 0}
    <p class="hint">No folders yet.</p>
  {:else}
    <ul>
      {#each rows as row (row.folder.id)}
        <li>
          <div class="info">
            <span class="name">{row.folder.name}</span>
            {#if row.permission !== 'granted'}
              <span class="detail warn">Needs your permission to be read</span>
            {:else if row.scan}
              <span class="detail">
                {row.scan.files.toLocaleString()} files · {formatBytes(row.scan.bytes)}{row.scanning ? '…' : ''}
                {#if row.scan.skipped > 0}· {row.scan.skipped} unreadable{/if}
              </span>
            {:else}
              <span class="detail">Counting files…</span>
            {/if}
          </div>
          {#if row.permission !== 'granted'}
            <button class="link" onclick={() => allow(row)}>Allow</button>
          {/if}
          <button class="link" onclick={() => remove(row)} aria-label="Remove {row.folder.name}">Remove</button>
        </li>
      {/each}
    </ul>
  {/if}

  <button class="link" onclick={add}>Add folder…</button>
  {#if error}
    <p class="hint warn" role="alert">{error}</p>
  {/if}
</section>

<style>
  .folders {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    text-align: left;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }

  ul {
    margin: 0 0 8px;
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
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .detail.warn {
    color: var(--warn);
  }
</style>
