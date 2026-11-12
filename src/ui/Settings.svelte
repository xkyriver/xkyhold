<script lang="ts">
  import { t } from '../lib/i18n.svelte'
  import { KEEP_CHOICES, REMINDER_CHOICES } from '../lib/reminder'
  import { app, caps, changePassword, disconnect, explain, forgetDevice, savePreferences, signIn } from '../state/app.svelte'
  import Folders from './Folders.svelte'

  const MIN_PASSWORD = 8

  let changing = $state(false)
  let useRecoveryKey = $state(false)
  let current = $state('')
  let next = $state('')
  let next2 = $state('')
  let busy = $state(false)
  let message = $state<{ ok: boolean; text: string } | null>(null)
  let confirmForget = $state(false)

  const reminderLabel = (days: number) =>
    days === 0 ? t('Never') : days === 1 ? t('Every day') : days === 7 ? t('Every week') : t('Every {n} days', { n: days })
  const keepLabel = (months: number) =>
    months === 0 ? t('Forever') : months === 12 ? t('At least a year') : t('At least {n} months', { n: months })

  async function savePassword() {
    busy = true
    message = null
    try {
      await changePassword(useRecoveryKey ? { recoveryKey: current } : { password: current }, next)
      message = { ok: true, text: t('Your password was changed.') }
      changing = false
      current = next = next2 = ''
    } catch (err) {
      message = { ok: false, text: explain(err) }
    } finally {
      busy = false
    }
  }
</script>

{#if caps.folderAccess}
  <section class="card stack">
    <h2>{t('Folders to save')}</h2>
    <Folders />
  </section>
{/if}

{#if caps.folderAccess}
  <section class="card stack">
    <h2>{t('Backups')}</h2>
    <div>
      <label for="remind">{t('Remind me to back up')}</label>
      <select id="remind" value={app.remindDays} onchange={(e) => savePreferences({ remindDays: Number(e.currentTarget.value) })}>
        {#each REMINDER_CHOICES as days}<option value={days}>{reminderLabel(days)}</option>{/each}
      </select>
      <p class="small muted">{t('XkyHold never starts a backup by itself. It tells you when one is due and you decide.')}</p>
    </div>
    <div>
      <label for="keep">{t('Keep backups')}</label>
      <select id="keep" value={app.keepMonths} onchange={(e) => savePreferences({ keepMonths: Number(e.currentTarget.value) })}>
        {#each KEEP_CHOICES as months}<option value={months}>{keepLabel(months)}</option>{/each}
      </select>
      <p class="small muted">{t('Older backups are removed after each new backup. They stay in the Google Drive trash for 30 days.')}</p>
    </div>
  </section>
{/if}

<section class="card stack">
  <h2>{t('Google Drive')}</h2>
  <p class="muted small">
    {t('Backup “{name}”', { name: app.repoName })}{#if app.account}&nbsp;· {app.account}{/if}
  </p>
  <div class="row">
    {#if app.connected}
      <button class="btn" onclick={disconnect} disabled={!!app.job}>{t('Sign out of Google')}</button>
    {:else}
      <button class="btn primary" onclick={signIn}>{t('Continue with Google')}</button>
    {/if}
  </div>
</section>

<section class="card stack">
  <h2>{t('Password')}</h2>
  {#if !changing}
    <div><button class="btn" onclick={() => ((changing = true), (message = null))} disabled={!app.connected}>{t('Change password…')}</button></div>
  {:else}
    <div>
      <label for="cur">{useRecoveryKey ? t('Recovery key') : t('Current password')}</label>
      <input id="cur" type={useRecoveryKey ? 'text' : 'password'} bind:value={current} autocomplete="off" spellcheck="false" />
      <button class="link small" onclick={() => ((useRecoveryKey = !useRecoveryKey), (current = ''))}>
        {useRecoveryKey ? t('Use my password instead') : t('I forgot my password')}
      </button>
    </div>
    <div>
      <label for="new">{t('New password')}</label>
      <input id="new" type="password" bind:value={next} autocomplete="new-password" />
    </div>
    <div>
      <label for="new2">{t('Confirm password')}</label>
      <input id="new2" type="password" bind:value={next2} autocomplete="new-password" />
    </div>
    {#if next && next.length < MIN_PASSWORD}
      <p class="small muted">{t('Use at least {n} characters.', { n: MIN_PASSWORD })}</p>
    {:else if next2 && next !== next2}
      <p class="small muted">{t('The two passwords are different.')}</p>
    {/if}
    <div class="row end">
      <button class="btn" onclick={() => (changing = false)} disabled={busy}>{t('Cancel')}</button>
      <button class="btn primary" onclick={savePassword} disabled={busy || !current || next.length < MIN_PASSWORD || next !== next2}>
        {t('Change password')}
      </button>
    </div>
  {/if}
  {#if message}
    <div class="banner {message.ok ? 'ok' : 'warn'}" role="status"><span>{message.text}</span></div>
  {/if}
</section>

<section class="card stack">
  <h2>{t('This browser')}</h2>
  <p class="muted small">
    {t('Removes XkyHold’s settings from this browser. Your backup stays in Google Drive, and you can connect to it again with your password.')}
  </p>
  {#if !confirmForget}
    <div><button class="btn danger" onclick={() => (confirmForget = true)}>{t('Remove from this browser…')}</button></div>
  {:else}
    <div class="row">
      <button class="btn danger" onclick={forgetDevice}>{t('Yes, remove')}</button>
      <button class="btn" onclick={() => (confirmForget = false)}>{t('Cancel')}</button>
    </div>
  {/if}
</section>
