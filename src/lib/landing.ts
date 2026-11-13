import { i18n } from './i18n.svelte'

/** The landing page in the app's current language. */
export const landingHref = (): string => (i18n.lang === 'pt-PT' ? '/pt/' : '/')
