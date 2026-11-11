import { describe, expect, it } from 'vitest'
import { ptPT } from './i18n.pt-PT'
import { formatWhen, translate } from './i18n.svelte'

const sources = import.meta.glob<string>('../**/*.{svelte,ts}', { query: '?raw', import: 'default', eager: true })

/** Every literal passed to t() or translate() in the UI sources. */
function usedKeys(): Set<string> {
  const keys = new Set<string>()
  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('.test.ts')) continue
    for (const m of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1])
    for (const m of source.matchAll(/translate\(lang,\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1])
    for (const m of source.matchAll(/label: '([^']+)'/g)) keys.add(m[1])
  }
  return keys
}

describe('pt-PT dictionary', () => {
  const used = usedKeys()

  it('translates every string the app uses', () => {
    expect([...used].filter((k) => !(k in ptPT))).toEqual([])
  })

  it('has no entry the app no longer uses', () => {
    expect(Object.keys(ptPT).filter((k) => !used.has(k))).toEqual([])
  })

  it('keeps the same placeholders as the English text', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [key, value] of Object.entries(ptPT)) expect(vars(value), key).toEqual(vars(key))
  })
})

describe('translate', () => {
  it('falls back to English and fills placeholders', () => {
    expect(translate('en', '{files} files', { files: 3 })).toBe('3 files')
    expect(translate('pt-PT', '{files} files', { files: 3 })).toBe('3 ficheiros')
    expect(translate('pt-PT', 'Not in the dictionary')).toBe('Not in the dictionary')
  })
})

describe('formatWhen', () => {
  const now = new Date(2026, 10, 11, 18, 0)

  it('says today and yesterday', () => {
    expect(formatWhen(new Date(2026, 10, 11, 9, 12).toISOString(), now, 'en')).toMatch(/^Today, 09:12/)
    expect(formatWhen(new Date(2026, 10, 10, 23, 59).toISOString(), now, 'pt-PT')).toMatch(/^Ontem, 23:59/)
  })

  it('gives a full date for older backups', () => {
    expect(formatWhen(new Date(2026, 9, 3, 8, 5).toISOString(), now, 'pt-PT')).toBe('3 de outubro de 2026, 08:05')
  })
})
