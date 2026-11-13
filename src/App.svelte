<script lang="ts">
  import { i18n, LANGUAGES, setLanguage, t } from './lib/i18n.svelte'
  import type { Lang } from './lib/i18n.svelte'
  import { landingHref } from './lib/landing'
  import { reminder } from './lib/reminder'
  import { app, backupNow, caps, start } from './state/app.svelte'
  import type { View } from './state/app.svelte'
  import Home from './ui/Home.svelte'
  import Restore from './ui/Restore.svelte'
  import Settings from './ui/Settings.svelte'
  import Wizard from './ui/Wizard.svelte'

  const tabs: { id: View; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'restore', label: 'Restore' },
    { id: 'settings', label: 'Settings' },
  ]

  // The wizard stays up until it says it is done, even though the backup
  // counts as configured from the moment it is created (the recovery key
  // still has to be shown).
  let inWizard = $state(false)

  void start().then(() => (inWizard = !app.configured))
  $effect(() => {
    if (app.ready && !app.configured) inWizard = true
  })

  function finishWizard(view: View) {
    app.view = view
    inWizard = false
  }

  $effect(() => {
    document.documentElement.lang = i18n.lang
  })

  // A backup is never started for the user. When one is due they are told,
  // on whichever screen they are, and choose.
  const due = $derived(reminder(app.lastBackup?.time, app.remindDays))
  // Home already says it, with its own button.
  const remind = $derived(
    // Before connecting, only what this device remembers is known.
    caps.folderAccess && (app.loaded || !!app.lastBackup) && !app.job && !app.opening && due.due && !app.reminderDismissed && app.view !== 'home',
  )

  function backUpFromReminder() {
    app.view = 'home'
    void backupNow()
  }
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand"><img src="/favicon.svg" alt="" /> XkyHold</div>
    {#if app.ready && !inWizard}
      <nav class="tabs" aria-label={t('Sections')}>
        {#each tabs as tab}
          <button class="tab" aria-current={app.view === tab.id ? 'page' : undefined} onclick={() => (app.view = tab.id)}>
            {t(tab.label)}
          </button>
        {/each}
      </nav>
    {/if}
  </header>

  <main class="page">
    {#if caps.mode === 'unsupported'}
      <section class="card stack">
        <h1>{t('This browser is not supported')}</h1>
        <p class="muted">{t('Open XkyHold in a recent version of Chrome, Edge, Firefox or Safari.')}</p>
        <p class="small"><a href={landingHref()}>{t('What is XkyHold?')}</a></p>
      </section>
    {:else if !app.ready}
      <p class="muted">{t('Loading…')}</p>
    {:else if inWizard}
      <Wizard done={finishWizard} />
    {:else}
      {#if app.error}
        <div class="banner warn" role="alert">
          <span>{app.error}</span>
          <button class="link" onclick={() => (app.error = null)}>{t('Dismiss')}</button>
        </div>
      {/if}
      {#if app.notice}
        <div class="banner ok" role="status">
          <span>{app.notice}</span>
          <button class="link" onclick={() => (app.notice = null)}>{t('Dismiss')}</button>
        </div>
      {/if}

      {#if remind}
        <div class="banner info" role="status">
          <span>
            {#if due.days === null}
              {t('You have not made a backup yet.')}
            {:else if due.days <= 1}
              {t('Your last backup was more than a day ago.')}
            {:else}
              {t('Your last backup was {n} days ago.', { n: due.days })}
            {/if}
          </span>
          <button class="btn primary" onclick={backUpFromReminder}>{t('Back up now')}</button>
          <button class="btn" onclick={() => (app.reminderDismissed = true)}>{t('Not now')}</button>
        </div>
      {/if}

      {#if app.view === 'home'}
        <Home />
      {:else if app.view === 'restore'}
        <Restore />
      {:else}
        <Settings />
      {/if}
    {/if}
  </main>

  <footer class="footer">
    <span>XkyHold v{__APP_VERSION__}</span>
    <a href="/privacy.html">{t('Privacy')}</a>
    <a href="/terms.html">{t('Terms')}</a>
    <a href="mailto:privacy@xkyhold.xkyriver.com">{t('Contact')}</a>
    <a href="https://github.com/xkyriver/xkyhold">{t('Source code')}</a>
    <select
      aria-label={t('Language')}
      value={i18n.lang}
      onchange={(e) => setLanguage(e.currentTarget.value as Lang)}
    >
      {#each LANGUAGES as language}<option value={language.id}>{language.name}</option>{/each}
    </select>
  </footer>
</div>
