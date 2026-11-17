import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError, DRIVE_SCOPE, GoogleAuth, isFresh, parseTokenResponse } from './google'

const NOW = 1_000_000

describe('parseTokenResponse', () => {
  it('computes the expiry from expires_in', () => {
    const t = parseTokenResponse({ access_token: 'abc', expires_in: 3599, scope: DRIVE_SCOPE }, NOW)
    expect(t).toEqual({ accessToken: 'abc', expiresAt: NOW + 3_599_000 })
  })

  it('accepts expires_in as a string and extra scopes', () => {
    const t = parseTokenResponse({ access_token: 'abc', expires_in: '10', scope: `openid ${DRIVE_SCOPE}` }, NOW)
    expect(t.expiresAt).toBe(NOW + 10_000)
  })

  it('rejects an error response', () => {
    expect(() => parseTokenResponse({ error: 'access_denied' }, NOW)).toThrow(AuthError)
  })

  it('rejects a token without the Drive scope', () => {
    expect(() => parseTokenResponse({ access_token: 'abc', expires_in: 10, scope: 'openid' }, NOW)).toThrow(
      /not granted/,
    )
  })
})

describe('isFresh', () => {
  it('is false for no token', () => {
    expect(isFresh(null, NOW)).toBe(false)
  })

  it('treats a token inside the safety margin as expired', () => {
    expect(isFresh({ accessToken: 'a', expiresAt: NOW + 30_000 }, NOW)).toBe(false)
    expect(isFresh({ accessToken: 'a', expiresAt: NOW + 120_000 }, NOW)).toBe(true)
  })
})

describe('GoogleAuth.signIn', () => {
  /** Stands in for Google's script: records what the app asks for and grants a token. */
  function fakeGoogle() {
    const asked: { hint?: string; prompt?: string }[] = []
    const oauth2 = {
      initTokenClient(config: { login_hint?: string; callback: (r: object) => void }) {
        return {
          requestAccessToken(overrides?: { prompt?: string }) {
            asked.push({ hint: config.login_hint, prompt: overrides?.prompt })
            config.callback({ access_token: 'abc', expires_in: 3600, scope: DRIVE_SCOPE })
          },
        }
      },
    }
    vi.stubGlobal('window', { google: { accounts: { oauth2 } } })
    vi.stubGlobal('document', {
      createElement: () => ({}),
      head: { append: (script: { onload: () => void }) => script.onload() },
    })
    return asked
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the account by default, and lists the accounts when asked to', async () => {
    const asked = fakeGoogle()
    const auth = new GoogleAuth('client')
    await auth.signIn('someone@example.com')
    await auth.signIn(undefined, { chooseAccount: true })
    expect(asked).toEqual([
      { hint: 'someone@example.com', prompt: '' },
      { hint: undefined, prompt: 'select_account' },
    ])
    expect(auth.current()?.accessToken).toBe('abc')
  })
})
