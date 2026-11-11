import { useRouter, useSearch } from '@tanstack/react-router'
import { useMemo, useSyncExternalStore } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { searchOf } from '../../../../../platform/navigate-search'
import { usePageMoves } from '../../../../../platform/page-moves'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { useSearchValue } from '../../../../../platform/search-value'
import { SESSION } from '../../../../../platform/session.port'
import { useListed } from '../../../../../platform/use-listed'
import { ACCOUNTS_SERVICE } from '../../../application/accounts.service'
import {
  ACCOUNT_ITEM,
  createUsersMachine,
  OPEN_ACCOUNT,
  SEARCH_INPUT,
} from '../../../application/users.machine'
import {
  ACCOUNTS_LIST_SOURCE,
  AccountSearchSchema,
  DEFAULT_ACCOUNT_PAGE_SIZE,
} from '../../../domain/account-search.entity'

import { UsersView } from './users.view'

export function UsersContainer() {
  const accounts = useService(ACCOUNTS_SERVICE)
  const session = useService(SESSION)
  const router = useRouter()
  // The route read the address already: this reads it with the same schema, typed.
  const search = z.parse(AccountSearchSchema, useSearch({ strict: false }))
  const [text, setText] = useSearchValue('q')
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  // The page of the address, read for the account signed in: again whenever the account or the
  // search, the page or the size changes, a read for an earlier one dropped.
  const listed = useListed(
    () => accounts.list({ q: search.q ?? '', page: search.page, size: search.size }),
    user?.id,
    0,
    { source: ACCOUNTS_LIST_SOURCE, search },
  )
  const machine = useMemo(() => createUsersMachine(), [])
  const { state, send, submit } = useScreenMachine('console.users', machine)
  // The links to the pages before and after and the size select move along this route.
  const moves = usePageMoves(search, DEFAULT_ACCOUNT_PAGE_SIZE)

  return (
    <UsersView
      text={text}
      onText={setText}
      onSearch={() =>
        submit({ type: 'console.users.search-button', fields: { [SEARCH_INPUT]: text } })
      }
      page={listed.failure === undefined ? listed.list : undefined}
      failure={listed.failure}
      at={{ page: search.page, size: search.size }}
      pageHref={moves.pageHref}
      onPage={(page) => void moves.toPage(page)}
      onSize={(size) => void moves.toSize(size)}
      accountHref={(id) =>
        router.buildLocation({
          to: OPEN_ACCOUNT.to,
          search: searchOf(OPEN_ACCOUNT.search, {}, { [ACCOUNT_ITEM]: id }),
        }).href
      }
      onOpen={(id) => send({ type: 'console.users.list.open-link', items: { [ACCOUNT_ITEM]: id } })}
      can={(event) => state.can(event)}
    />
  )
}
