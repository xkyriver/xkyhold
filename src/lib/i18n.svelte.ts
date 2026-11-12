// English is the source language: the key is the English text. Other
// languages map each key to its translation; a missing entry falls back to
// English, so the app never shows a blank label.

import { now as clockNow } from './clock'
import { ptPT } from './i18n.pt-PT'

export type Lang = 'en' | 'pt-PT'
export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'pt-PT', name: 'Português' },
]

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, 'pt-PT': ptPT }
const STORAGE_KEY = 'xkyhold.lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'pt-PT') return saved
  } catch {
    // no storage: fall through to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt') ? 'pt-PT' : 'en'
}

export const i18n = $state({ lang: initial() })

export function setLanguage(lang: Lang): void {
  i18n.lang = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // not remembered; still applied for this visit
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

export function translate(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const text = dictionaries[lang][key] ?? key
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** Translates `key` into the current language. Reactive in templates. */
export const t = (key: string, vars?: Record<string, string | number>): string => translate(i18n.lang, key, vars)

/** "1 file" or "3 files", in the current language. */
export const fileCount = (n: number): string => (n === 1 ? t('1 file') : t('{files} files', { files: n.toLocaleString() }))

/** "Today, 09:12", "Yesterday, 18:40" or a full date. */
export function formatWhen(iso: string, now: Date = clockNow(), lang: Lang = i18n.lang): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(date)
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000)
  if (days === 0) return translate(lang, 'Today, {time}', { time })
  if (days === 1) return translate(lang, 'Yesterday, {time}', { time })
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  return `${day}, ${time}`
}
