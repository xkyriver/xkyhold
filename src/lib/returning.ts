// The landing page (/ and /pt/) sends people who already use XkyHold in this
// browser straight to the app (/app/). It runs before the page renders, so
// it cannot wait for IndexedDB: the app leaves this flag in localStorage
// whenever it knows whether a backup is set up here.

export const RETURNING_KEY = 'xkyhold.returning'

export function markReturning(on: boolean): void {
  try {
    if (on) localStorage.setItem(RETURNING_KEY, '1')
    else localStorage.removeItem(RETURNING_KEY)
  } catch {
    // no storage: the landing page simply shows itself
  }
}
