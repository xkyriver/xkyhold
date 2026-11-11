<script lang="ts">
  import { formatBytes } from '../lib/format'
  import { formatWhen, t } from '../lib/i18n.svelte'
  import { allowFolders, app, backupNow, caps, retryOpen, signIn, stopJob } from '../state/app.svelte'

  const last = $derived(app.snapshots.at(-1))
  const blocked = $derived(app.folders.filter((f) => f.permission !== 'granted').length)
  const working = $derived(app.job?.kind === 'backup')
</script>

{#if !app.connected}
  <div class="banner info">
    <span>{t('Connect to Google Drive to back up or restore.')}</span>
    <button class="btn primary" onclick={signIn}>{t('Continue with Google')}</button>
  </div>
{:else if !app.loaded && !app.opening}
  <div class="banner warn">
    <span>{t('Your backup could not be opened.')}</span>
    <button class="btn" onclick={retryOpen}>{t('Try again')}</button>
  </div>
{/if}

{#if blocked > 0 && caps.folderAccess}
  <div class="banner warn">
    <span>{t('XkyHold needs your permission to read your folders again.')}</span>
    <button class="btn" onclick={allowFolders}>{t('Allow')}</button>
  </div>
{/if}

<section class="card center stack">
  <div class="mark" class:ok={!!last && !working} class:busy={working} aria-hidden="true">
    {#if working}
      <span class="spinner"></span>
    {:else if last}
      ✓
    {:else}
      ↑
    {/if}
  </div>

  {#if working && app.job}
    <h1>{t('Backing up…')}</h1>
    <p class="muted">
      {t('{files} files', { files: app.job.files.toLocaleString() })} · {formatBytes(app.job.bytes)}
    </p>
    <p class="small muted current">{app.job.current || ' '}</p>
    <div><button class="btn" onclick={stopJob}>{t('Stop')}</button></div>
    <p class="small muted">{t('Keep this page open until the backup finishes.')}</p>
  {:else}
    {#if app.opening}
      <h1>{t('Opening your backup…')}</h1>
    {:else if last}
      <h1>{t('Your files are safe')}</h1>
      <p class="muted">
        {t('Last backup: {when}', { when: formatWhen(last.time) })}<br />
        {t('{files} files', { files: last.stats.files.toLocaleString() })} · {formatBytes(last.stats.bytes)}
      </p>
    {:else}
      <h1>{t('No backup yet')}</h1>
      <p class="muted">{t('Make your first backup now.')}</p>
    {/if}

    {#if caps.folderAccess}
      <div>
        <button class="btn primary big" onclick={backupNow} disabled={!app.loaded || !!app.job}>{t('Back up now')}</button>
      </div>
    {:else}
      <p class="small muted">{t('This browser can restore files. To make backups, open XkyHold in Chrome or Edge on a computer.')}</p>
    {/if}
  {/if}
</section>

{#if last?.stats.skipped}
  <p class="small muted">{t('{n} files could not be read in the last backup.', { n: last.stats.skipped })}</p>
{/if}

<style>
  .mark {
    width: 64px;
    height: 64px;
    margin: 4px auto 0;
    display: grid;
    place-items: center;
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 50%;
  }

  .mark.ok {
    color: var(--ok);
    background: var(--ok-soft);
  }

  .mark.busy {
    background: var(--accent-soft);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--accent);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 4s;
    }
  }

  .current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
