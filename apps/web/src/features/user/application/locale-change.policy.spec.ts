import { describe, expect, it } from 'vitest'

import { localeChange } from './locale-change.policy'

describe('localeChange', () => {
  it('applies the stored language when the profile first arrives', () => {
    expect(localeChange({ stored: 'es', current: 'en', first: true })).toEqual({ apply: 'es' })
    expect(localeChange({ stored: 'en', current: 'en', first: true })).toBeUndefined()
  })

  it('stores the current language when the profile has none it can use', () => {
    expect(localeChange({ stored: undefined, current: 'en', first: true })).toEqual({ save: 'en' })
    expect(localeChange({ stored: 'fr', current: 'es', first: true })).toEqual({ save: 'es' })
  })

  it('stores a language the user chose later', () => {
    expect(localeChange({ stored: 'es', current: 'en', first: false })).toEqual({ save: 'en' })
    expect(localeChange({ stored: 'en', current: 'en', first: false })).toBeUndefined()
  })
})
