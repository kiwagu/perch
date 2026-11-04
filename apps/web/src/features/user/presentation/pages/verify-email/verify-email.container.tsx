import { useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { createVerifyEmailMachine } from '../../../application/verify-email.machine'
import { VERIFY_EMAIL_SERVICE } from '../../../application/verify-email.service'
import { useLinkExchange } from '../../components/link-exchange/link-exchange'
import { RouterLink } from '../../components/page-link/page-link'

import { VerifyEmailView } from './verify-email.view'

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

/**
 * The page a verification mail's link opens: one exchange of the token its address names (none is
 * an empty one, which the session refuses as a link that does not work, asking nobody). Another
 * token in the address while the page is open, as a move of the same router would bring, starts
 * another exchange with its own machine: the outcome shown is always the current token's.
 */
export function VerifyEmailContainer() {
  const { token = '' } = search.parse(useSearch({ strict: false }))

  return <TokenExchange key={token} token={token} />
}

/** The screen's flow run as its machine over one token, for as long as the address names it. */
function TokenExchange(props: { readonly token: string }) {
  const { token } = props
  const service = useService(VERIFY_EMAIL_SERVICE)
  // The gateway signs a device in only at a link's first exchange, so a second one, which React's
  // StrictMode would start in development, would answer "verified before": it is kept.
  const verify = useLinkExchange((each: string) => service.verify(each))
  const machine = useMemo(
    () => createVerifyEmailMachine({ token, verify, resend: (email) => service.resend(email) }),
    [service, token, verify],
  )
  const { state, submit, renders } = useScreenMachine('user.verify-email', machine)

  return (
    <VerifyEmailView
      renders={renders}
      message={state.context.message}
      sentTo={state.context.sentTo}
      error={state.context.error}
      canResend={state.can({ type: 'user.verify-email.resend-button', email: '' })}
      onResend={(email) => submit({ type: 'user.verify-email.resend-button', email })}
      link={RouterLink}
    />
  )
}
