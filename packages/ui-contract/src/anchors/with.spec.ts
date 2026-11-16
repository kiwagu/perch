import { describe, expect, it } from 'vitest'

import { entryAnchorOf, entryCodesOf } from './with'

describe('an entry of with or without', () => {
  it('names an anchor, with no codes', () => {
    expect(entryAnchorOf('app-shell.update-message')).toBe('app-shell.update-message')
    expect(entryCodesOf('app-shell.update-message')).toBeUndefined()
  })

  it('names one anchor with the codes it shows', () => {
    const entry = { 'app-shell.install-message': ['install-available'] }

    expect(entryAnchorOf(entry)).toBe('app-shell.install-message')
    expect(entryCodesOf(entry)).toEqual(['install-available'])
  })
})
