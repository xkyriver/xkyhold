/// <reference types="vite/client" />
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Development only: prefills the backup password with a throwaway value. */
  readonly VITE_TEST_REPO_PASSWORD?: string
}
