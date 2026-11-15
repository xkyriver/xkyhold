import { i18n } from './i18n.svelte'

/** The landing page in the app's current language. */
export const landingHref = (): string => (i18n.lang === 'pt-PT' ? '/pt/' : '/')

/** The XkyHold-lx page in the app's current language. */
export const linuxHref = (): string => (i18n.lang === 'pt-PT' ? '/pt/linux/' : '/linux/')

/**
 * A desktop with Linux (not Android or ChromeOS, which also say Linux).
 * The same test as public/landing-os.js.
 */
export function onLinuxDesktop(userAgent: string, platform: string): boolean {
  return /linux/i.test(`${platform} ${userAgent}`) && !/android|cros/i.test(userAgent)
}

export function isLinuxDesktop(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return onLinuxDesktop(nav.userAgent ?? '', nav.userAgentData?.platform ?? nav.platform ?? '')
}
