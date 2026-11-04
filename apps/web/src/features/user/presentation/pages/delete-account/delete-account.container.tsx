import { useSearch } from '@tanstack/react-router'
import { useMemo, useSyncExternalStore } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { createDeleteAccountMachine } from '../../../application/delete-account.machine'
import { RouterLink } from '../../components/page-link/page-link'

import { DeleteAccountView } from './delete-account.view'

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

const DELETE_BUTTON = { type: 'user.delete-account.delete-button' } as const

/**
 * The page a deletion mail's link opens, over the token its address names (none is an empty one,
 * which the session refuses as a link that does not work, asking nobody). Another token in the
 * address while the page is open starts afresh with its own machine. The page is open whoever is
 * signed in: a deletion of the account signed in here signs this device out, and the page keeps
 * its message, which its machine holds whatever the session does.
 */
export function DeleteAccountContainer() {
  const { token = '' } = search.parse(useSearch({ strict: false }))

  return <AccountDeletion key={token} token={token} />
}

/** The screen's flow run as its machine over one token. */
function AccountDeletion(props: { readonly token: string }) {
  const session = useService(SESSION)
  // The sign-in link is a guest's, and the deletion itself may turn this device into one.
  const guest = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current() === undefined,
  )
  const machine = useMemo(
    () =>
      createDeleteAccountMachine({
        token: props.token,
        deleteAccount: (token) => session.deleteAccount(token),
      }),
    [session, props.token],
  )
  const { state, send, renders } = useScreenMachine('user.delete-account', machine)

  return (
    <DeleteAccountView
      message={state.context.message}
      error={state.context.error}
      renders={renders}
      canDelete={state.can(DELETE_BUTTON)}
      guest={guest}
      onDelete={() => send(DELETE_BUTTON)}
      link={RouterLink}
    />
  )
}
