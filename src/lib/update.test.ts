import { describe, expect, it } from 'vitest'
import { fetchDeployed, parseVersion, updateWaiting } from './update'

describe('update notice', () => {
  const deployed = { version: '1.2.0', build: 'b2' }

  it('waits when the deployed build is another one', () => {
    expect(updateWaiting('b1', deployed, null)).toBe(true)
    expect(updateWaiting('b2', deployed, null)).toBe(false)
  })

  it('stays quiet for a build set aside with "Not now", until the next one', () => {
    expect(updateWaiting('b1', deployed, 'b2')).toBe(false)
    expect(updateWaiting('b1', { version: '1.3.0', build: 'b3' }, 'b2')).toBe(true)
  })

  it('says nothing without a clear answer', () => {
    expect(updateWaiting('b1', null, null)).toBe(false)
    expect(parseVersion({ version: '1.2.0' })).toBeNull()
    expect(parseVersion({ version: '1.2.0', build: '' })).toBeNull()
    expect(parseVersion('<html>')).toBeNull()
    expect(parseVersion(deployed)).toEqual(deployed)
  })

  it('treats a network failure or a missing file as no answer', async () => {
    const down = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    const missing = (() => Promise.resolve(new Response('nope', { status: 404 }))) as unknown as typeof fetch
    const ok = (() => Promise.resolve(Response.json(deployed))) as unknown as typeof fetch
    expect(await fetchDeployed(down)).toBeNull()
    expect(await fetchDeployed(missing)).toBeNull()
    expect(await fetchDeployed(ok)).toEqual(deployed)
  })
})
