import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '@workspace/i18n'

import { NOTHING_SEEN, SettingWrites } from './setting-writes'

const none = SettingWrites.none(SUPPORTED_LOCALES)

describe('SettingWrites', () => {
  it('takes the first stored value to arrive for one stored elsewhere', () => {
    expect(none.elsewhere('es')).toBe('es')
    expect(none.arrived('es').elsewhere('es')).toBeUndefined()
  })

  it("takes another tab's or device's value for one stored elsewhere", () => {
    expect(none.arrived('en').elsewhere('es')).toBe('es')
  })

  it('knows its own write coming back, and the value it brings is seen once it arrives', () => {
    const writing = none.arrived('en').writing('es')

    expect(writing.elsewhere('es')).toBeUndefined()

    const again = writing.arrived('es').writing('en')

    expect(again.elsewhere('en')).toBeUndefined()
  })

  it('lets another tab or device overtake the writes on their way', () => {
    // Another device's value arrives before this tab's es came back: es is no longer on its way,
    // so an es arriving later is another device's too.
    const overtaken = none.arrived('en').writing('es').arrived('pt')

    expect(overtaken.elsewhere('es')).toBe('es')
  })

  it('forgets a write that failed', () => {
    expect(none.arrived('en').writing('es').failed('es').elsewhere('es')).toBe('es')
  })

  it('takes no value the setting does not take', () => {
    expect(none.elsewhere('fr')).toBeUndefined()
  })

  it("knows nothing of a new account's language", () => {
    expect(NOTHING_SEEN.locale.elsewhere('en')).toBe('en')
  })
})
