import { describe, expect, it } from 'vitest'

import { entriesShowOn, entryAnchorOf, entryCodesOf, entryShowsOn } from './with'

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

describe('whether an entry shows on a page', () => {
  const on = (anchor: string, visible: boolean, code?: string) =>
    code === undefined
      ? { anchor, kind: 'message', visible }
      : { anchor, kind: 'message', visible, code }
  const entry = { 'x.y.install-message': ['install-available'] }

  it('reads an anchor entry from its visible elements', () => {
    expect(entryShowsOn('x.y.update-message', [on('x.y.update-message', true)])).toBe(true)
    expect(entryShowsOn('x.y.update-message', [on('x.y.update-message', false)])).toBe(false)
    expect(entryShowsOn('x.y.update-message', [])).toBe(false)
  })

  it('reads a code entry from the codes, and leaves it unsaid where a visible one carries none', () => {
    expect(entryShowsOn(entry, [on('x.y.install-message', true, 'install-available')])).toBe(true)
    expect(entryShowsOn(entry, [on('x.y.install-message', true, 'install-by-steps')])).toBe(false)
    expect(entryShowsOn(entry, [on('x.y.install-message', false, 'install-available')])).toBe(false)
    expect(entryShowsOn(entry, [on('x.y.install-message', true)])).toBeUndefined()
  })

  it('says an element shows only while each with entry shows and no without entry does', () => {
    const page = [on('x.y.update-message', true)]

    expect(entriesShowOn({ with: ['x.y.update-message'] }, page)).toBe(true)
    expect(entriesShowOn({ without: ['x.y.update-message'] }, page)).toBe(false)
    expect(entriesShowOn({ with: [entry] }, page)).toBe(false)
    expect(entriesShowOn({ with: [entry] }, [on('x.y.install-message', true)])).toBe(false)
    expect(entriesShowOn({}, page)).toBe(true)
  })
})
