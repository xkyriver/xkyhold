<script lang="ts">
  // First-run setup: Google -> which backup -> (folders -> password ->
  // recovery key) for a new one, or just the password for an existing one.
  import { adoptAbout } from '../lib/about'
  import { t } from '../lib/i18n.svelte'
  import { app, caps, connectBackup, createBackup, defaultBackupName, explain, listBackups, signIn } from '../state/app.svelte'
  import type { View } from '../state/app.svelte'
  import Folders from './Folders.svelte'

  let { done }: { done: (view: View) => void } = $props()

  type Step = 'google' | 'choose' | 'folders' | 'password' | 'recovery' | 'unlock'
  const NEW = '\u0000new'
  const MIN_PASSWORD = 8
  // Development convenience: a throwaway password from .env.local.
  const prefill = import.meta.env.DEV ? (import.meta.env.VITE_TEST_REPO_PASSWORD ?? '') : ''

  let step = $state<Step>(app.connected ? 'choose' : 'google')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let existing = $state<string[] | null>(null)
  let choice = $state(NEW)
  let name = $state(defaultBackupName())
  let password = $state(prefill)
  let password2 = $state(prefill)
  let useRecoveryKey = $state(false)
  let recoveryInput = $state('')
  let recoveryKey = $state('')
  let saved = $state(false)
  let copied = $state(false)

  const canCreate = caps.folderAccess
  const steps = $derived<Step[]>(
    choice === NEW ? ['google', 'choose', 'folders', 'password', 'recovery'] : ['google', 'choose', 'unlock'],
  )

  async function run(work: () => Promise<void>) {
    busy = true
    error = null
    try {
      await work()
    } catch (err) {
      error = explain(err)
    } finally {
      busy = false
    }
  }

  const loadBackups = () =>
    run(async () => {
      existing = await listBackups()
      if (!canCreate) choice = existing[0] ?? NEW
      else if (existing.includes(name)) choice = name
    })

  $effect(() => {
    if (step === 'choose' && existing === null && !busy && !error) void loadBackups()
  })

  async function google() {
    busy = true
    const ok = await signIn()
    busy = false
    error = app.error
    if (ok) step = 'choose'
  }

  function chosen() {
    error = null
    if (choice !== NEW) step = 'unlock'
    else if (existing?.includes(name.trim())) error = t('A backup with this name already exists. Choose another name.')
    else step = 'folders'
  }

  const create = () =>
    run(async () => {
      recoveryKey = await createBackup(name.trim(), password)
      password = password2 = ''
      step = 'recovery'
    })

  const unlock = () =>
    run(async () => {
      await connectBackup(choice, useRecoveryKey ? { recoveryKey: recoveryInput } : { password })
      password = ''
      done(canCreate ? 'home' : 'restore')
    })

  async function copy() {
    await navigator.clipboard.writeText(recoveryKey)
    copied = true
  }

  function download() {
    const text = `${t('XkyHold recovery key')}\n\n${t('Backup')}: ${app.repoName}\n${recoveryKey}\n\n${t('Keep this somewhere safe, away from your computer. Anyone who has it can open your backup.')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'xkyhold-recovery-key.txt'
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<div class="card stack">
  <ol class="dots" aria-label={t('Step {n} of {total}', { n: steps.indexOf(step) + 1, total: steps.length })}>
    {#each steps as s}<li class:on={steps.indexOf(s) <= steps.indexOf(step)}></li>{/each}
  </ol>

  {#if step === 'google'}
    <h1>{t('Keep your files safe')}</h1>
    <p class="muted">
      {t('XkyHold saves the folders you choose to your own Google Drive. Your files are encrypted on this computer first, so only you can read them.')}
    </p>
    {#if !canCreate}
      <div class="banner info">
        <span>{t('This browser can restore files from a backup. To make backups, open XkyHold in Chrome or Edge on a computer.')}</span>
      </div>
    {/if}
    <button class="btn primary big block" onclick={google} disabled={busy}>
      {busy ? t('Waiting for Google…') : t('Continue with Google')}
    </button>
    <p class="small muted">{t('XkyHold can only see the files it creates in your Drive. Nothing else.')}</p>
  {:else if step === 'choose'}
    <h1>{t('Your backup')}</h1>
    {#if existing === null}
      <p class="muted">{error ? '' : t('Looking for your backups…')}</p>
      {#if error}<button class="btn" onclick={loadBackups} disabled={busy}>{t('Try again')}</button>{/if}
    {:else}
      {#if existing.length > 0}
        <p class="muted">{t('Connect to a backup you already have, or start a new one.')}</p>
        <div class="stack tight" role="radiogroup">
          {#each existing as backupName}
            <label class="option"><input type="radio" bind:group={choice} value={backupName} /> {backupName}</label>
          {/each}
          {#if canCreate}
            <label class="option"><input type="radio" bind:group={choice} value={NEW} /> {t('Start a new backup')}</label>
          {/if}
        </div>
      {:else if !canCreate}
        <p class="muted">{t('There is no backup in this Google account yet.')}</p>
      {/if}
      {#if choice === NEW && canCreate}
        <div>
          <label for="backup-name">{t('Name of this backup')}</label>
          <input id="backup-name" type="text" bind:value={name} autocomplete="off" spellcheck="false" />
          <p class="small muted">{t('Use a different name on each computer.')}</p>
        </div>
      {/if}
      <div class="row end">
        <button class="btn primary" onclick={chosen} disabled={choice === NEW && (!canCreate || !name.trim())}>
          {t('Continue')}
        </button>
      </div>
    {/if}
  {:else if step === 'folders'}
    <h1>{t('Folders to save')}</h1>
    <p class="muted">
      {t('Choose the folders you want to keep safe. When the browser asks, pick “Allow on every visit” so you are not asked again.')}
    </p>
    <Folders />
    <div class="row between">
      <button class="btn" onclick={() => (step = 'choose')}>{t('Back')}</button>
      <button class="btn primary" onclick={() => (step = 'password')} disabled={app.folders.length === 0}>{t('Continue')}</button>
    </div>
  {:else if step === 'password'}
    <h1>{t('Protect your backup')}</h1>
    <p class="muted">{t('Your files are encrypted with this password before they leave this computer.')}</p>
    <div>
      <label for="pw">{t('Password')}</label>
      <input id="pw" type="password" bind:value={password} autocomplete="new-password" />
    </div>
    <div>
      <label for="pw2">{t('Confirm password')}</label>
      <input id="pw2" type="password" bind:value={password2} autocomplete="new-password" />
    </div>
    <p class="small muted">
      {#if password && password.length < MIN_PASSWORD}
        {t('Use at least {n} characters.', { n: MIN_PASSWORD })}
      {:else if password2 && password !== password2}
        {t('The two passwords are different.')}
      {:else}
        {t('Next you will get a recovery key, in case you forget this password.')}
      {/if}
    </p>
    <div class="row between">
      <button class="btn" onclick={() => (step = 'folders')} disabled={busy}>{t('Back')}</button>
      <button class="btn primary" onclick={create} disabled={busy || password.length < MIN_PASSWORD || password !== password2}>
        {busy ? t('Creating your backup…') : t('Create backup')}
      </button>
    </div>
  {:else if step === 'recovery'}
    <h1>{t('Save your recovery key')}</h1>
    <p class="muted">{t('If you forget your password, this key is the only other way to open your backup. It is shown only once.')}</p>
    <p class="key">{recoveryKey}</p>
    <div class="row">
      <button class="btn" onclick={download}>{t('Download')}</button>
      <button class="btn" onclick={() => window.print()}>{t('Print')}</button>
      <button class="btn" onclick={copy}>{copied ? t('Copied') : t('Copy')}</button>
    </div>
    <label class="option"><input type="checkbox" bind:checked={saved} /> {t('I have saved my recovery key somewhere safe')}</label>
    <div class="row end">
      <button class="btn primary" onclick={() => done('home')} disabled={!saved}>{t('Finish')}</button>
    </div>
  {:else if step === 'unlock'}
    <h1>{t('Open “{name}”', { name: choice })}</h1>
    {#if useRecoveryKey}
      <div>
        <label for="rk">{t('Recovery key')}</label>
        <input id="rk" type="text" bind:value={recoveryInput} autocomplete="off" spellcheck="false" />
      </div>
    {:else}
      <div>
        <label for="pw">{t('Password')}</label>
        <input id="pw" type="password" bind:value={password} autocomplete="current-password" />
      </div>
    {/if}
    <button class="link small" onclick={() => (useRecoveryKey = !useRecoveryKey)}>
      {useRecoveryKey ? t('Use my password instead') : t('I forgot my password')}
    </button>
    <div class="row between">
      <button class="btn" onclick={() => (step = 'choose')} disabled={busy}>{t('Back')}</button>
      <button class="btn primary" onclick={unlock} disabled={busy || !(useRecoveryKey ? recoveryInput.trim() : password)}>
        {busy ? t('Opening your backup…') : t('Open backup')}
      </button>
    </div>
  {/if}

  {#if error}<div class="banner warn" role="alert"><span>{error}</span></div>{/if}
</div>

{#if step === 'google'}
  <!-- What XkyHold is, for someone who has just arrived (static, from index.html). -->
  <div use:adoptAbout></div>
{/if}

<style>
  .dots {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dots li {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
  }

  .dots li.on {
    background: var(--accent);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 10px 12px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .option:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .key {
    padding: 16px;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1rem;
    line-height: 1.9;
    text-align: center;
    word-spacing: 0.2em;
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    user-select: all;
  }
</style>
