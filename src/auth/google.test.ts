import { describe, expect, it } from 'vitest'
import { AuthError, DRIVE_SCOPE, isFresh, parseTokenResponse } from './google'

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
