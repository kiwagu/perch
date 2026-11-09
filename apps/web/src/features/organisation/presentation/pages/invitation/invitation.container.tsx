import { Link, useSearch } from '@tanstack/react-router'
import { errAsync } from 'neverthrow'
import { useMemo, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import {
  createInvitationMachine,
  type InvitationEvent,
} from '../../../application/invitation.machine'
import { ORGANISATION_SERVICE } from '../../../application/organisation.service'

import { type InvitationLinkProps, InvitationView } from './invitation.view'

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

const ACCEPT = { type: 'organisation.invitation.accept-button' } as const satisfies InvitationEvent
const DECLINE = {
  type: 'organisation.invitation.decline-button',
} as const satisfies InvitationEvent

/** An address without a token: a link that opens nothing, which the gateway is not asked about. */
const NO_TOKEN: BusError = { code: 'link-invalid', message: 'the address carries no token' }

const RouterLink = ({ to, ...props }: InvitationLinkProps) => <Link to={to} {...props} />

/**
 * The page the link of an invitation mail opens, over the token its address names (none is a
 * link that does not work). Another token in the address while the page is open starts afresh
 * with its own machine. The page is open whoever is signed in: what it offers depends on whether
 * the invitation is for the account signed in here.
 */
export function InvitationContainer() {
  const { token = '' } = search.parse(useSearch({ strict: false }))

  return <InvitationOfToken key={token} token={token} />
}

/** The screen's flow run as its machine over one token. */
function InvitationOfToken(props: { readonly token: string }) {
  const session = useService(SESSION)
  const organisations = useService(ORGANISATION_SERVICE)
  // The sign-in link is a guest's alone, and someone may sign in while the page is open.
  const guest = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current() === undefined,
  )
  const machine = useMemo(
    () =>
      createInvitationMachine({
        token: props.token,
        read: (token) => (token === '' ? errAsync(NO_TOKEN) : organisations.readInvitation(token)),
        accept: (invitation) => organisations.accept(invitation),
        decline: (invitation) => organisations.decline(invitation),
        current: () => session.current()?.id,
      }),
    [organisations, session, props.token],
  )
  const { state, send, renders } = useScreenMachine('organisation.invitation', machine)

  return (
    <InvitationView
      organisation={state.context.organisation}
      joinAs={state.context.role}
      message={state.context.message}
      error={state.context.error}
      renders={renders}
      canAccept={state.can(ACCEPT)}
      canDecline={state.can(DECLINE)}
      guest={guest}
      onAccept={() => send(ACCEPT)}
      onDecline={() => send(DECLINE)}
      link={RouterLink}
    />
  )
}
