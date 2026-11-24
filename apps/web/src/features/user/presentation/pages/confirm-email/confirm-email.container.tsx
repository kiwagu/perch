import { useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { createConfirmEmailMachine } from '../../../application/confirm-email.machine'
import { useLinkExchange } from '../../components/link-exchange/link-exchange'
import { RouterLink } from '../../components/page-link/page-link'

import { ConfirmEmailView } from './confirm-email.view'

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

/**
 * The page a confirmation mail's link opens, whoever is signed in here: one exchange of the token
 * its address names (none is an empty one, which the session refuses as a link that does not work,
 * asking nobody); another token in the address starts another with its own machine.
 */
export function ConfirmEmailContainer() {
  const { token = '' } = search.parse(useSearch({ strict: false }))

  return <TokenConfirmation key={token} token={token} />
}

/** The screen's flow run as its machine over one token. */
function TokenConfirmation(props: { readonly token: string }) {
  const session = useService(SESSION)
  // The gateway takes a link once, so a second exchange, which React's StrictMode would start in
  // development, would answer as for a link used before: it is kept.
  const confirm = useLinkExchange((token: string) => session.confirmEmail(token))
  const machine = useMemo(
    () =>
      createConfirmEmailMachine({
        token: props.token,
        confirm,
        current: () => session.current()?.id,
      }),
    [confirm, session, props.token],
  )
  const { state, renders } = useScreenMachine('user.confirm-email', machine)

  return (
    <ConfirmEmailView
      renders={renders}
      message={state.context.message}
      error={state.context.error}
      link={RouterLink}
    />
  )
}
