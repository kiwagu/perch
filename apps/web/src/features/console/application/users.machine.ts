import { emit, setup } from 'xstate'

import type { FieldValues, ItemIds, NavigateParams } from '../../../platform/flow-effects'

/** The search box, whose text a search moves with. */
export const SEARCH_INPUT = 'console.users.search-input'

/** An entry of the list: one account, its id its `data-id`. */
export const ACCOUNT_ITEM = 'console.users.list.account-item'

/** The events of the screen's flow: the search button with what the box holds, a row's link. */
export type UsersEvent =
  | {
      readonly type: 'console.users.search-button'
      readonly fields: { readonly [SEARCH_INPUT]: string }
    }
  | {
      readonly type: 'console.users.list.open-link'
      readonly items: { readonly [ACCOUNT_ITEM]: string }
    }

/** What the machine asks of its host: a move, with what the box holds or the row acted in. */
export type UsersEmitted = { readonly type: 'navigate' } & NavigateParams & {
    readonly fields?: FieldValues
    readonly items?: ItemIds
  }

/** A new search: the first page of what the box holds, the page size kept by the route. */
const SEARCH = {
  to: '/console/users',
  search: { q: { anchor: SEARCH_INPUT }, page: 1 },
} as const satisfies NavigateParams

/** The card of the account whose row's link was followed, the account in the address. */
export const OPEN_ACCOUNT = {
  to: '/console/account',
  search: { id: { item: ACCOUNT_ITEM } },
} as const satisfies NavigateParams

/**
 * The page of the platform's accounts as its screen's flow says
 * (`contract/domain/screens/console/users.yaml`): the search button moves to the first page of
 * what the box holds, and a row's link to that account's card, which ends the page. Its
 * `navigate` emits the move with what the box holds (`fields`) or the row acted in (`items`), for
 * the host to move with. The list, its pages and its size are the route's: the page reads them.
 */
export function createUsersMachine() {
  return setup({
    types: { events: {} as UsersEvent, emitted: {} as UsersEmitted },
    actions: {
      navigate: emit(({ event }, params: NavigateParams) => ({
        type: 'navigate' as const,
        ...params,
        ...('fields' in event ? { fields: event.fields } : {}),
        ...('items' in event ? { items: event.items } : {}),
      })),
    },
  }).createMachine({
    id: 'console.users',
    initial: 'viewing',
    states: {
      viewing: {
        on: {
          'console.users.search-button': { actions: [{ type: 'navigate', params: SEARCH }] },
          'console.users.list.open-link': {
            target: 'opened',
            actions: [{ type: 'navigate', params: OPEN_ACCOUNT }],
          },
        },
      },
      opened: { type: 'final' },
    },
  })
}
