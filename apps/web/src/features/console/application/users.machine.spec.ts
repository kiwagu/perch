import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'

import { createUsersMachine, type UsersEmitted } from './users.machine'

const SEARCH_INPUT = 'console.users.search-input'
const ACCOUNT_ITEM = 'console.users.list.account-item'

/** The users page's machine, running, with what it emitted. */
function running() {
  const actor = createActor(createUsersMachine())
  const emitted: UsersEmitted[] = []

  actor.on('navigate', (event) => emitted.push(event))
  actor.start()

  return { actor, emitted }
}

describe('the users page as its flow says', () => {
  it('moves to the first page of what the search box holds, staying on the page', () => {
    const { actor, emitted } = running()

    actor.send({ type: 'console.users.search-button', fields: { [SEARCH_INPUT]: 'ann' } })

    expect(actor.getSnapshot().value).toBe('viewing')
    expect(emitted).toEqual([
      {
        type: 'navigate',
        to: '/console/users',
        search: { q: { anchor: SEARCH_INPUT }, page: 1 },
        fields: { [SEARCH_INPUT]: 'ann' },
      },
    ])
  })

  it('searches as often as the button is pressed', () => {
    const { actor, emitted } = running()

    actor.send({ type: 'console.users.search-button', fields: { [SEARCH_INPUT]: 'ann' } })
    actor.send({ type: 'console.users.search-button', fields: { [SEARCH_INPUT]: '' } })

    expect(emitted.map((event) => event.fields)).toEqual([
      { [SEARCH_INPUT]: 'ann' },
      { [SEARCH_INPUT]: '' },
    ])
  })

  it("opens the card of the account whose row's link was followed, and ends", () => {
    const { actor, emitted } = running()

    actor.send({ type: 'console.users.list.open-link', items: { [ACCOUNT_ITEM]: 'idn_ann' } })

    expect(actor.getSnapshot().value).toBe('opened')
    expect(actor.getSnapshot().status).toBe('done')
    expect(emitted).toEqual([
      {
        type: 'navigate',
        to: '/console/account',
        search: { id: { item: ACCOUNT_ITEM } },
        items: { [ACCOUNT_ITEM]: 'idn_ann' },
      },
    ])
  })
})
