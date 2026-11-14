/// <reference types="vite/client" />
declare const __APP_VERSION__: string
/** The build this page came from (vite.config.ts). */
declare const __APP_BUILD__: string

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Development only: prefills the backup password with a throwaway value. */
  readonly VITE_TEST_REPO_PASSWORD?: string
}
