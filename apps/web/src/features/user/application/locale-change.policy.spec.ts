import { describe, expect, it } from 'vitest'

import { localeChange } from './locale-change.policy'

const none: readonly string[] = []

describe('localeChange', () => {
  it('applies the stored language when the settings first arrive', () => {
    expect(localeChange({ stored: 'es', seen: undefined, written: none, current: 'en' })).toEqual({
      apply: 'es',
    })
    expect(
      localeChange({ stored: 'en', seen: undefined, written: none, current: 'en' }),
    ).toBeUndefined()
  })

  it('applies a language another device stored meanwhile, and never stores this one back', () => {
    expect(localeChange({ stored: 'es', seen: 'en', written: none, current: 'en' })).toEqual({
      apply: 'es',
    })
  })

  it('stores a language the user chose here, once while it is on its way', () => {
    expect(localeChange({ stored: 'en', seen: 'en', written: none, current: 'es' })).toEqual({
      save: 'es',
    })
    expect(
      localeChange({ stored: 'en', seen: 'en', written: ['es'], current: 'es' }),
    ).toBeUndefined()
  })

  it('keeps a return to the stored language when the earlier write of this device arrives', () => {
    // es chosen and written, then en chosen again before the write of es came back.
    expect(
      localeChange({ stored: 'en', seen: 'en', written: ['es'], current: 'en' }),
    ).toBeUndefined()
    expect(localeChange({ stored: 'es', seen: 'en', written: ['es'], current: 'en' })).toEqual({
      save: 'en',
    })
  })

  it('stores the current language when the settings hold none it can use', () => {
    expect(
      localeChange({ stored: undefined, seen: undefined, written: none, current: 'en' }),
    ).toEqual({ save: 'en' })
  })
})
