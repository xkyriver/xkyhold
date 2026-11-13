<script lang="ts">
  // Browse the sub-folders of one chosen folder and untick the ones that
  // should stay out of backups. Reads the folder through the handle the user
  // already allowed, so no second system dialog is needed.
  import type { DirHandleLike } from '../fs/handles'
  import { t } from '../lib/i18n.svelte'

  let {
    root,
    leftOut,
    change,
    close,
  }: {
    root: DirHandleLike
    leftOut: string[]
    change: (path: string, out: boolean) => void
    close: () => void
  } = $props()

  /** Where we are inside the root, as folder names. */
  let trail = $state<string[]>([])
  let names = $state<string[] | null>(null)
  let failed = $state(false)

  const here = (name: string) => [...trail, name].join('/')
  const isOut = (name: string) => leftOut.includes(here(name))

  async function dirAt(path: string[]): Promise<DirHandleLike> {
    let dir = root
    for (const name of path) {
      let next: DirHandleLike | undefined
      for await (const entry of dir.values()) {
        if (entry.kind === 'directory' && entry.name === name) {
          next = entry
          break
        }
      }
      if (!next) throw new Error(`missing ${name}`)
      dir = next
    }
    return dir
  }

  $effect(() => {
    const path = [...trail]
    names = null
    failed = false
    let cancelled = false
    ;(async () => {
      try {
        const out: string[] = []
        for await (const entry of (await dirAt(path)).values()) if (entry.kind === 'directory') out.push(entry.name)
        if (!cancelled) names = out.sort((a, b) => a.localeCompare(b))
      } catch {
        if (!cancelled) failed = true
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

<div class="leave-out stack">
  <p class="small muted">{t('Untick the folders you do not want in your backup.')}</p>

  <nav class="crumbs small" aria-label={t('Folder')}>
    <button class="link" onclick={() => (trail = [])} disabled={trail.length === 0}>{root.name}</button>
    {#each trail as name, i}
      <span aria-hidden="true">/</span>
      <button class="link" onclick={() => (trail = trail.slice(0, i + 1))} disabled={i === trail.length - 1}>{name}</button>
    {/each}
  </nav>

  {#if failed}
    <p class="small muted">{t('This folder could not be read.')}</p>
  {:else if names === null}
    <p class="small muted">{t('Loading…')}</p>
  {:else if names.length === 0}
    <p class="small muted">{t('No folders inside.')}</p>
  {:else}
    <ul class="list">
      {#each names as name (name)}
        <li>
          <label class="grow option">
            <input type="checkbox" checked={!isOut(name)} onchange={(e) => change(here(name), !e.currentTarget.checked)} />
            <span class:out={isOut(name)}>{name}</span>
          </label>
          {#if !isOut(name)}
            <button class="link" onclick={() => (trail = [...trail, name])} aria-label={t('Open {name}', { name })}>›</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <p class="small muted">{t('Files already in earlier backups stay there until those backups are removed.')}</p>
  <div><button class="btn" onclick={close}>{t('Done')}</button></div>
</div>

<style>
  .leave-out {
    padding: 12px 14px;
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }

  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .crumbs .link:disabled {
    color: var(--text);
    opacity: 1;
    font-weight: 600;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .out {
    color: var(--muted);
    text-decoration: line-through;
  }
</style>
