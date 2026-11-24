import { describe, expect, it } from 'vitest'

import { type InEntry, itemIdOf } from './item'

const ITEM = 'console.users.list.account-item'

/**
 * A control inside an entry of `item` whose `data-id` is `id` (none when `id` is null): its
 * `closest` finds the entry only by the selector of that anchor, as the page's does.
 */
function controlIn(item: string, id: string | null): InEntry & { readonly asked: string[] } {
  const asked: string[] = []
  const entry = { getAttribute: (name: string) => (name === 'data-id' ? id : null) }

  return {
    asked,
    closest: (selector) => {
      asked.push(selector)

      return selector === `[data-testid="${item}"]` ? entry : null
    },
  }
}

describe('the id of the entry a control is in', () => {
  it("is the data-id of the closest entry of the item's anchor", () => {
    const control = controlIn(ITEM, 'idn_0000000000000000.01m52pexcp')

    expect(itemIdOf(control, ITEM)).toBe('idn_0000000000000000.01m52pexcp')
    expect(control.asked).toEqual([`[data-testid="${ITEM}"]`])
  })

  it('is never guessed outside an entry of that item: it throws', () => {
    expect(() => itemIdOf(controlIn('device.list.session-item', 'dvs_1'), ITEM)).toThrow(ITEM)
  })

  it('is never guessed from an entry without an id, or with an empty one: it throws', () => {
    expect(() => itemIdOf(controlIn(ITEM, null), ITEM)).toThrow(ITEM)
    expect(() => itemIdOf(controlIn(ITEM, ''), ITEM)).toThrow(ITEM)
  })
})
