import { describe, expect, it } from 'vitest'

import { containersOf, ENTRY_KINDS, entryOf, inPartOf } from './entries'

const kinds = (anchors: Record<string, string>) =>
  Object.fromEntries(Object.entries(anchors).map(([anchor, kind]) => [anchor, { kind }]))

describe('containersOf', () => {
  it('finds the list an entry is declared under, the nearest first', () => {
    const anchors = kinds({
      'device.list': 'list',
      'device.list.session-item': 'item',
      'device.list.revoke-button': 'button',
    })

    expect(containersOf('device.list.session-item', anchors)).toEqual(['device.list'])
  })

  it('finds a list, a table or a section declared beside the entry in its part', () => {
    const anchors = kinds({
      'organisation.notes.section': 'section',
      'organisation.notes.list': 'list',
      'organisation.notes.item': 'item',
      'organisation.notes.edit-button': 'button',
      'organisation.members.table': 'table',
      'organisation.members.row': 'row',
    })

    expect(containersOf('organisation.notes.item', anchors)).toEqual([
      'organisation.notes.section',
      'organisation.notes.list',
    ])
    expect(containersOf('organisation.members.row', anchors)).toEqual([
      'organisation.members.table',
    ])
  })

  it('takes no container from another part, nor anything that lists nothing', () => {
    const anchors = kinds({
      'sample.notes.list': 'list',
      'sample.other.thing-item': 'item',
      'sample.other.form': 'form',
      'sample.other': 'panel',
    })

    expect(containersOf('sample.other.thing-item', anchors)).toEqual([])
  })
})

describe('inPartOf', () => {
  it('holds for a control declared beside the entry in its part, never the entry itself', () => {
    expect(inPartOf('console.users.list.account-item', 'console.users.list.open-link')).toBe(true)
    expect(inPartOf('console.users.list.account-item', 'console.users.list.account-item')).toBe(
      false,
    )
    expect(inPartOf('console.users.list.account-item', 'console.users.search-button')).toBe(false)
    expect(
      inPartOf('console.users.list.account-item', 'console.users.list.account-item.open-link'),
    ).toBe(false)
  })
})

describe('entryOf', () => {
  const anchors = kinds({
    'sample.things.section': 'section',
    'sample.things.list': 'list',
    'sample.things.item': 'item',
    'sample.things.text-cell': 'cell',
    'sample.things.delete-button': 'button',
    'sample.page.heading': 'heading',
    'device.list': 'list',
    'device.list.session-item': 'item',
    'device.list.session-item.label-cell': 'cell',
    'device.list.revoke-button': 'button',
  })

  it('finds the entry an anchor of its part, or one declared under it, renders in', () => {
    expect(entryOf('sample.things.text-cell', anchors)).toBe('sample.things.item')
    expect(entryOf('sample.things.delete-button', anchors)).toBe('sample.things.item')
    expect(entryOf('device.list.revoke-button', anchors)).toBe('device.list.session-item')
    expect(entryOf('device.list.session-item.label-cell', anchors)).toBe('device.list.session-item')
  })

  it('finds none for the entry itself, its containers, another part or an unknown anchor', () => {
    expect(entryOf('sample.things.item', anchors)).toBeUndefined()
    expect(entryOf('sample.things.list', anchors)).toBeUndefined()
    expect(entryOf('sample.things.section', anchors)).toBeUndefined()
    expect(entryOf('device.list', anchors)).toBeUndefined()
    expect(entryOf('sample.page.heading', anchors)).toBeUndefined()
    expect(entryOf('sample.things.gone-button', anchors)).toBeUndefined()
  })
})

describe('ENTRY_KINDS', () => {
  it('names the kinds that mark every entry of their container', () => {
    expect([...ENTRY_KINDS]).toEqual(['item', 'row'])
  })
})
