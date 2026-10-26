import { describe, expect, it } from 'vitest'

import { LocaleWrites } from './locale-writes'

describe('LocaleWrites', () => {
  it('takes the first stored language to arrive for one stored elsewhere', () => {
    expect(LocaleWrites.none.elsewhere('es')).toBe('es')
    expect(LocaleWrites.none.arrived('es').elsewhere('es')).toBeUndefined()
  })

  it("takes another device's language for one stored elsewhere", () => {
    expect(LocaleWrites.none.arrived('en').elsewhere('es')).toBe('es')
  })

  it('knows its own write coming back, and the language it brings is seen once it arrives', () => {
    const writing = LocaleWrites.none.arrived('en').writing('es')

    expect(writing.elsewhere('es')).toBeUndefined()

    const again = writing.arrived('es').writing('en')

    expect(again.elsewhere('en')).toBeUndefined()
  })

  it('lets another device overtake the writes on their way', () => {
    // Another device's language arrives before this device's es came back: es is no longer on
    // its way, so an es arriving later is another device's too.
    const overtaken = LocaleWrites.none.arrived('en').writing('es').arrived('pt')

    expect(overtaken.elsewhere('es')).toBe('es')
  })

  it('forgets a write that failed', () => {
    expect(LocaleWrites.none.arrived('en').writing('es').failed('es').elsewhere('es')).toBe('es')
  })

  it('takes no language the app does not speak', () => {
    expect(LocaleWrites.none.elsewhere('fr')).toBeUndefined()
  })
})
