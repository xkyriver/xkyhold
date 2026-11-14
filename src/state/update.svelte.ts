// The "new version" notice: checks when the app opens, when the tab comes
// back into view and every 6 hours. Updating is reloading the page.

import { fetchDeployed, updateWaiting } from '../lib/update'

const DISMISSED_KEY = 'xkyhold.updateDismissed'
const EVERY_MS = 6 * 60 * 60 * 1000

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

export const update = $state({ waiting: false, build: null as string | null })

async function check() {
  const deployed = await fetchDeployed()
  if (updateWaiting(__APP_BUILD__, deployed, readDismissed())) {
    update.waiting = true
    update.build = deployed!.build
  }
}

let started = false

export function startUpdateChecks() {
  if (started) return
  started = true
  void check()
  setInterval(() => void check(), EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  // A file of the old build is gone from the server: that is a new version.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    update.waiting = true
  })
}

export function reloadForUpdate() {
  location.reload()
}

export function notNow() {
  update.waiting = false
  if (!update.build) return
  try {
    localStorage.setItem(DISMISSED_KEY, update.build)
  } catch {
    // no storage: the notice comes back with the next check
  }
}
