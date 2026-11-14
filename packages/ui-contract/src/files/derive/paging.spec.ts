import { describe, expect, it } from 'vitest'

import { withDerivedPaging } from './paging'

const FILE = 'contract/domain/screens/console/users.yaml'

const screenWith = (anchors: Record<string, unknown>) => ({ id: 'console.users', anchors })

const anchorsOf = (value: unknown) => (value as { anchors: Record<string, unknown> }).anchors

describe('withDerivedPaging', () => {
  it('derives the range, the two links and the size select of a paged list', () => {
    const { value, problems } = withDerivedPaging(
      FILE,
      screenWith({
        'console.users.list': {
          kind: 'list',
          source: { platform: 'accounts.list', paged: true },
        },
      }),
    )

    expect(problems).toEqual([])
    expect(anchorsOf(value)['console.users.list']).toEqual({
      kind: 'list',
      source: { platform: 'accounts.list', paged: true },
      derived: ['range', 'previous-link', 'next-link', 'size-select'],
    })
  })

  it('keeps the suffixes a list writes, before the parts of its paging', () => {
    const { value } = withDerivedPaging(
      FILE,
      screenWith({
        'console.users.list': {
          kind: 'list',
          source: { platform: 'accounts.list', paged: true },
          derived: ['item'],
        },
      }),
    )

    expect(anchorsOf(value)['console.users.list']).toMatchObject({
      derived: ['item', 'range', 'previous-link', 'next-link', 'size-select'],
    })
  })

  it('refuses a part of the paging a screen file writes itself', () => {
    const { value, problems } = withDerivedPaging(
      FILE,
      screenWith({
        'console.users.list': {
          kind: 'list',
          source: { platform: 'accounts.list', paged: true },
          derived: ['item', 'range', 'size-select'],
        },
      }),
    )

    expect(problems).toEqual([
      {
        file: FILE,
        message:
          'anchors["console.users.list"].derived[1]: "range" is derived by the paged source of the list: a screen file never writes it',
      },
      {
        file: FILE,
        message:
          'anchors["console.users.list"].derived[2]: "size-select" is derived by the paged source of the list: a screen file never writes it',
      },
    ])
    expect(anchorsOf(value)['console.users.list']).toMatchObject({
      derived: ['item', 'range', 'previous-link', 'next-link', 'size-select'],
    })
  })

  it('leaves alone a source that does not page, an entity source and what is no anchor', () => {
    const anchors = {
      'device.list': { kind: 'list', source: { platform: 'devices.list' } },
      'organisation.notes.section': { kind: 'section', source: { entity: 'note' } },
      'sample.page': { kind: 'page', derived: ['range'] },
    }

    expect(withDerivedPaging(FILE, screenWith(anchors))).toEqual({
      value: screenWith(anchors),
      problems: [],
    })
    expect(withDerivedPaging(FILE, 'no screen')).toEqual({ value: 'no screen', problems: [] })
  })
})
