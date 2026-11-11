import { describe, expect, it } from 'vitest'
import { detectCapabilities } from './capabilities'

const base = {
  isSecureContext: true,
  crypto: { subtle: {} },
  indexedDB: {},
  Worker: function () {},
}

describe('detectCapabilities', () => {
  it('is full when folders can be picked', () => {
    const c = detectCapabilities({ ...base, showDirectoryPicker: () => {} })
    expect(c).toEqual({ folderAccess: true, core: true, mode: 'full' })
  })

  it('is restore-only without the folder picker', () => {
    expect(detectCapabilities(base).mode).toBe('restore-only')
  })

  it('is unsupported outside a secure context, even with the picker', () => {
    const c = detectCapabilities({ ...base, isSecureContext: false, showDirectoryPicker: () => {} })
    expect(c).toEqual({ folderAccess: false, core: false, mode: 'unsupported' })
  })

  it('is unsupported without WebCrypto', () => {
    expect(detectCapabilities({ ...base, crypto: {} }).mode).toBe('unsupported')
  })
})
