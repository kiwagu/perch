import { describe, expect, it } from 'vitest'

import { containersOf, ENTRY_KINDS, inPartOf } from './entries'

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

describe('ENTRY_KINDS', () => {
  it('names the kinds that mark every entry of their container', () => {
    expect([...ENTRY_KINDS]).toEqual(['item', 'row'])
  })
})
