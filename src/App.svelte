<script lang="ts">
  import { AuthError, googleAuth } from './auth/google'
  import { detectCapabilities } from './lib/capabilities'
  import Folders from './ui/Folders.svelte'

  const caps = detectCapabilities()

  let busy = $state(false)
  let account = $state<string | null>(null)
  let error = $state<string | null>(null)

  // Phase 0 check: sign in, then ask Drive who we are to prove the token works.
  async function signIn() {
    busy = true
    error = null
    try {
      const token = await googleAuth.signIn()
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      })
      if (!res.ok) throw new Error(`Google Drive answered ${res.status}`)
      const { user } = await res.json()
      account = user?.emailAddress ?? user?.displayName ?? 'Google account'
    } catch (err) {
      if (err instanceof AuthError && err.code === 'cancelled') return
      console.error(err)
      error =
        err instanceof AuthError && err.code === 'interaction_required'
          ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
          : 'Could not sign in to Google. Please try again.'
    } finally {
      busy = false
    }
  }

  async function signOut() {
    await googleAuth.signOut()
    account = null
  }
</script>

<main>
  <section class="card">
    <h1>XkyHold</h1>
    <p class="lead">Keep your files safe in your own Google Drive.</p>

    {#if caps.mode === 'full'}
      <p class="note ok">This browser can back up and restore.</p>
    {:else if caps.mode === 'restore-only'}
      <p class="note">This browser can restore files. To back up, open XkyHold in Chrome or Edge on a computer.</p>
    {:else}
      <p class="note warn">This browser is not supported.</p>
    {/if}

    {#if caps.mode !== 'unsupported'}
      {#if account}
        <p class="note ok">Connected as {account}</p>
        <button class="link" onclick={signOut}>Disconnect</button>
      {:else}
        <button class="primary" onclick={signIn} disabled={busy || !googleAuth.configured}>
          {busy ? 'Waiting for Google…' : 'Sign in with Google'}
        </button>
        {#if !googleAuth.configured}
          <p class="hint">No Google client ID configured (see docs/OAUTH.md).</p>
        {/if}
        {#if error}
          <p class="hint warn" role="alert">{error}</p>
        {/if}
      {/if}
    {/if}

    {#if caps.folderAccess}
      <Folders />
    {/if}
  </section>
  <footer>v{__APP_VERSION__}</footer>
</main>
