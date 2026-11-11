// Google sign-in through Google Identity Services (token model).
//
// There is no server, so there is no refresh token: an access token lasts
// about an hour and a new one is requested through the same popup flow. A
// popup can only be opened from a user gesture, so callers must be ready
// for a missing token (see `current`) and offer the user a button.

/** drive.file: the app only sees files and folders it created itself. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export type AuthErrorCode = 'not_configured' | 'load_failed' | 'cancelled' | 'denied' | 'interaction_required'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface Token {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type: string }) => void
    login_hint?: string
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } }
  }
}

/** Renew this long before the real expiry, so a request never races it. */
const EXPIRY_MARGIN_MS = 60_000

export function isFresh(token: Token | null, now: number = Date.now()): token is Token {
  return token !== null && token.expiresAt - EXPIRY_MARGIN_MS > now
}

/** Turns a GIS token response into a Token, or throws an AuthError. */
export function parseTokenResponse(response: TokenResponse, now: number = Date.now()): Token {
  if (response.error || !response.access_token) {
    throw new AuthError('denied', response.error ?? 'No access token returned')
  }
  // With granular consent the user can untick the Drive permission.
  if (response.scope !== undefined && !response.scope.split(' ').includes(DRIVE_SCOPE)) {
    throw new AuthError('denied', 'Google Drive access was not granted')
  }
  const seconds = Number(response.expires_in)
  return {
    accessToken: response.access_token,
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  }
}

let gisLoading: Promise<GoogleOAuth2> | null = null

function loadGis(): Promise<GoogleOAuth2> {
  gisLoading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      const oauth2 = window.google?.accounts.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new AuthError('load_failed', 'Google sign-in did not load'))
    }
    script.onerror = () => reject(new AuthError('load_failed', 'Google sign-in did not load'))
    document.head.append(script)
  }).catch((err) => {
    gisLoading = null // allow a retry, e.g. after coming back online
    throw err
  })
  return gisLoading
}

const SESSION_KEY = 'xkyhold.token'

/** Survives a reload of the tab, never a restart of the browser. */
const session = {
  load(): Token | null {
    try {
      const token = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Token | null
      return isFresh(token) ? token : null
    } catch {
      return null
    }
  },
  save(token: Token | null): void {
    try {
      if (token) sessionStorage.setItem(SESSION_KEY, JSON.stringify(token))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // storage unavailable: the token just lives in memory
    }
  },
}

export class GoogleAuth {
  private token: Token | null = session.load()

  constructor(private readonly clientId: string) {}

  get configured(): boolean {
    return this.clientId !== ''
  }

  /** The current token if it is still good; never opens a popup. */
  current(): Token | null {
    return isFresh(this.token) ? this.token : null
  }

  /**
   * Opens Google's popup and resolves with a token. Must be called from a
   * user gesture (a click), or the browser blocks the popup.
   */
  async signIn(accountHint?: string): Promise<Token> {
    if (!this.configured) throw new AuthError('not_configured', 'No Google client ID configured')
    const oauth2 = await loadGis()
    this.token = await new Promise<Token>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        login_hint: accountHint,
        callback: (response) => {
          try {
            resolve(parseTokenResponse(response))
          } catch (err) {
            reject(err)
          }
        },
        error_callback: (error) => {
          reject(
            error.type === 'popup_failed_to_open'
              ? new AuthError('interaction_required', 'The sign-in window was blocked')
              : new AuthError('cancelled', 'Sign-in was cancelled'),
          )
        },
      })
      // '' = no consent screen again if the user already granted access.
      client.requestAccessToken({ prompt: '' })
    })
    session.save(this.token)
    return this.token
  }

  /** Drops a token the server rejected, so `current` stops offering it. */
  invalidate(): void {
    this.token = null
    session.save(null)
  }

  /** Forgets the token and revokes the app's access at Google. */
  async signOut(): Promise<void> {
    const token = this.token
    this.invalidate()
    if (!token) return
    const oauth2 = await loadGis()
    await new Promise<void>((resolve) => oauth2.revoke(token.accessToken, resolve))
  }
}

export const googleAuth = new GoogleAuth(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
