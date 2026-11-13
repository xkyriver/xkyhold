<script lang="ts">
  // Where folders dragged from the file manager are dropped, many at once.
  // With `group`, they go inside that folder made in XkyHold.
  import { addDropped, canDropFolders } from '../fs/folders'
  import { t } from '../lib/i18n.svelte'
  import { refreshFolders } from '../state/app.svelte'

  let { group, hint }: { group?: string; hint: string } = $props()

  const allowed = canDropFolders()
  let dragging = $state(false)
  let note = $state<string | null>(null)

  function dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragging = true
  }

  async function drop(event: DragEvent) {
    event.preventDefault()
    dragging = false
    note = null
    if (!event.dataTransfer) return
    try {
      const result = await addDropped(event.dataTransfer.items, group)
      await refreshFolders()
      const notes: string[] = []
      if (result.added === 1) notes.push(group ? t('1 item added.') : t('1 folder added.'))
      else if (result.added > 1) notes.push(group ? t('{n} items added.', { n: result.added }) : t('{n} folders added.', { n: result.added }))
      if (result.files === 1) notes.push(t('Files go inside a folder made with “New folder…”, so 1 file was not added.'))
      else if (result.files > 1)
        notes.push(t('Files go inside a folder made with “New folder…”, so {n} files were not added.', { n: result.files }))
      if (result.refused === 1) notes.push(t('The browser did not allow 1 item.'))
      else if (result.refused > 1) notes.push(t('The browser did not allow {n} items.', { n: result.refused }))
      if (result.clashed === 1) notes.push(t('1 item was not added because there is already one with the same name.'))
      else if (result.clashed > 1)
        notes.push(t('{n} items were not added because there are already others with the same names.', { n: result.clashed }))
      if (notes.length === 0) notes.push(t('They were already in the list.'))
      note = notes.join(' ')
    } catch (err) {
      console.error(err)
      note = t('That folder cannot be used. Choose another one, such as a folder inside Documents.')
    }
  }
</script>

{#if allowed}
  <div
    class="drop small"
    class:dragging
    role="region"
    aria-label={t('Drop folders here')}
    ondragover={dragOver}
    ondragleave={() => (dragging = false)}
    ondrop={drop}
  >
    {dragging ? t('Drop the folders to add them') : hint}
  </div>
  {#if note}<p class="small muted" role="status">{note}</p>{/if}
{/if}

<style>
  .drop {
    padding: 18px 14px;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--muted);
    text-align: center;
  }

  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
</style>
