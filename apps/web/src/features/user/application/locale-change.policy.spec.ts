import { describe, expect, it } from 'vitest'

import { localeChange } from './locale-change.policy'

describe('localeChange', () => {
  it('applies the stored language when the settings first arrive', () => {
    expect(localeChange({ stored: 'es', seen: undefined, current: 'en' })).toEqual({ apply: 'es' })
    expect(localeChange({ stored: 'en', seen: undefined, current: 'en' })).toBeUndefined()
  })

  it('applies a language another device stored meanwhile, and never stores this one back', () => {
    expect(localeChange({ stored: 'es', seen: 'en', current: 'en' })).toEqual({ apply: 'es' })
  })

  it('stores a language the user chose here', () => {
    expect(localeChange({ stored: 'en', seen: 'en', current: 'es' })).toEqual({ save: 'es' })
    expect(localeChange({ stored: 'es', seen: 'es', current: 'es' })).toBeUndefined()
  })

  it('stores the current language when the settings hold none it can use', () => {
    expect(localeChange({ stored: undefined, seen: undefined, current: 'en' })).toEqual({
      save: 'en',
    })
  })
})
