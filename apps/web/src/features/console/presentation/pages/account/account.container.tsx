import { Link, useSearch } from '@tanstack/react-router'
import { useMemo, useState, useSyncExternalStore } from 'react'

import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { useFieldClears } from '../../../../../platform/field-clears'
import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { useListed } from '../../../../../platform/use-listed'
import { EMAIL_INPUT, REASON_INPUT } from '../../../application/account-machine/effects'
import { createAccountMachine } from '../../../application/account-machine/machine'
import { ACCOUNTS_SERVICE } from '../../../application/accounts.service'
import {
  ACCOUNT_SECTION_SOURCE,
  type AccountCardSearch,
  AccountCardSearchSchema,
  accountIdOf,
} from '../../../domain/account-card.entity'

import { type AccountLinkProps, AccountView } from './account.view'

/** The router's link, which the page gives its view. */
const RouterLink = ({ to, ...props }: AccountLinkProps) => <Link to={to} {...props} />

/**
 * The card of the account the address names. An address that names none, or names something
 * that is no identity id, names no account: the card says it is gone, asking the gateway nothing
 * (as an invitation's link without a token). Another account in the address starts the card
 * afresh: its fields, its errors and its flow.
 */
export function AccountContainer() {
  // The route read the address already: this reads it with the same schema, typed.
  const search = z.parse(AccountCardSearchSchema, useSearch({ strict: false }))
  const id = accountIdOf(search)

  return id === undefined ? (
    <AccountView account={undefined} failure="account-gone" link={RouterLink} />
  ) : (
    <AccountOfId key={id} id={id} search={search} />
  )
}

/** The card of the account `id`: its screen's flow run as its machine over the account. */
function AccountOfId(props: { readonly id: IdentityId; readonly search: AccountCardSearch }) {
  const accounts = useService(ACCOUNTS_SERVICE)
  const session = useService(SESSION)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const machine = useMemo(
    () => createAccountMachine({ id: props.id, accounts }),
    [accounts, props.id],
  )
  const { state, submit, actor } = useScreenMachine('console.account', machine)
  // The account, read for the operator signed in: again whenever the flow reads it after an
  // action, the card shown meanwhile as it was read.
  const listed = useListed(() => accounts.read(props.id), user?.id, state.context.sectionReads, {
    source: ACCOUNT_SECTION_SOURCE,
    search: props.search,
  })
  // The name as typed, none until something is: the field shows the name as read until then.
  const [name, setName] = useState<string | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const account = listed.failure === undefined ? listed.list : undefined

  useFieldClears(actor, { [EMAIL_INPUT]: () => setEmail(''), [REASON_INPUT]: () => setReason('') })

  return (
    <AccountView
      account={account}
      failure={listed.failure}
      link={RouterLink}
      areas={{
        errors: state.context.errors,
        name: name ?? account?.name ?? '',
        email,
        reason,
        onName: setName,
        onEmail: setEmail,
        onReason: setReason,
        can: (event) => state.can(event),
        onAct: submit,
      }}
    />
  )
}
