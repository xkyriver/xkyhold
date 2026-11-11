<script lang="ts">
  import { detectCapabilities } from './lib/capabilities'

  const caps = detectCapabilities()
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

    <button class="primary" disabled>Set up XkyHold</button>
    <p class="hint">Work in progress — setup is not available yet.</p>
  </section>
  <footer>v{__APP_VERSION__}</footer>
</main>
