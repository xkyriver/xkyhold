<script lang="ts">
  // Development-only panel: proves that a resumable upload to Google Drive
  // works from the browser, survives an interruption and arrives intact.
  import { googleAuth } from '../auth/google'
  import { formatBytes } from '../lib/format'
  import { Drive, uploadResumable } from '../storage/drive'

  const SIZE = 12 * 1024 * 1024
  const CHUNK = 2 * 1024 * 1024
  const SESSION_KEY = 'xkyhold.uploadTest.session'
  const drive = new Drive()

  let log = $state<string[]>([])
  let sent = $state(0)
  let running = $state(false)
  let fileId = $state<string | null>(null)
  let session = $state<string | null>(localStorage.getItem(SESSION_KEY))
  let abort: AbortController | null = null

  const say = (line: string) => (log = [...log, line])

  /** Deterministic bytes, so the same data can be rebuilt after a reload. */
  function testData(): Blob {
    const bytes = new Uint8Array(SIZE)
    let x = 0x9e3779b9
    for (let i = 0; i < SIZE; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      bytes[i] = x & 0xff
    }
    return new Blob([bytes])
  }

  async function sha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }

  async function run(resume: boolean) {
    running = true
    abort = new AbortController()
    try {
      const { accessToken } = await googleAuth.getToken()
      const data = testData()
      if (!resume || !session) {
        const folder = await drive.ensureFolder(accessToken, 'XkyHold-test')
        session = await drive.startUpload(accessToken, `upload-test-${Date.now()}.bin`, folder, data.size)
        localStorage.setItem(SESSION_KEY, session)
        say('Session opened')
      } else {
        say('Resuming existing session')
      }
      const started = performance.now()
      let first = true
      const file = await uploadResumable(drive, session, data, {
        chunkSize: CHUNK,
        signal: abort.signal,
        onProgress: (done) => {
          if (first) say(`Server has ${formatBytes(done)}; continuing from there`)
          first = false
          sent = done
        },
      })
      const seconds = (performance.now() - started) / 1000
      say(`Uploaded in ${seconds.toFixed(1)} s`)
      localStorage.removeItem(SESSION_KEY)
      session = null
      fileId = file.id

      const remote = await drive.getFile(accessToken, file.id)
      const local = await sha256(data)
      say(`Size: ${remote.size} (expected ${data.size})`)
      say(remote.sha256Checksum === local ? 'SHA-256 matches: file arrived intact' : 'SHA-256 MISMATCH')
    } catch (err) {
      say(abort.signal.aborted ? 'Interrupted' : `Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
    }
  }

  async function trash() {
    try {
      const { accessToken } = await googleAuth.getToken()
      await drive.trashFile(accessToken, fileId!)
      say('Test file moved to the Drive trash')
      fileId = null
    } catch (err) {
      say(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
</script>

<section class="test">
  <h2>Upload test (development only)</h2>
  <div class="actions">
    <button class="link" onclick={() => run(false)} disabled={running}>Start {formatBytes(SIZE)} upload</button>
    <button class="link" onclick={() => abort?.abort()} disabled={!running}>Interrupt</button>
    <button class="link" onclick={() => run(true)} disabled={running || !session}>Resume</button>
    <button class="link" onclick={trash} disabled={running || !fileId}>Trash test file</button>
  </div>
  <progress value={sent} max={SIZE}></progress>
  <ol>
    {#each log as line}
      <li>{line}</li>
    {/each}
  </ol>
</section>

<style>
  .test {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px dashed var(--border);
    text-align: left;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  progress {
    width: 100%;
    margin: 8px 0;
  }

  ol {
    margin: 0;
    padding-left: 20px;
    font-size: 0.8125rem;
    color: var(--muted);
  }
</style>
