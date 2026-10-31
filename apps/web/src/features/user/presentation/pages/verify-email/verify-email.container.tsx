import { Link, useSearch } from '@tanstack/react-router'
import { useMemo, useRef } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { createVerifyEmailMachine } from '../../../application/verify-email.machine'
import {
  VERIFY_EMAIL_SERVICE,
  type VerifyEmailService,
} from '../../../application/verify-email.service'

import { type VerifyEmailLinkProps, VerifyEmailView } from './verify-email.view'

const RouterLink = ({ to, ...props }: VerifyEmailLinkProps) => <Link to={to} {...props} />

/** One exchange of a token, started once, whatever outcome it ends with. */
type Exchange = ReturnType<VerifyEmailService['verify']>

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

/**
 * The page a verification mail's link opens: it runs the screen's flow as its machine over the
 * token of its address (none is an empty one, which the session refuses as a link that does not
 * work, asking nobody).
 */
export function VerifyEmailContainer() {
  const service = useService(VERIFY_EMAIL_SERVICE)
  const { token = '' } = search.parse(useSearch({ strict: false }))
  // React restarts a mounted screen's effects once in development (StrictMode), which starts its
  // machine's first invoke again; the gateway signs a device in only at a link's first exchange, so
  // a second exchange would answer "verified before". The exchange is kept by this mounted page
  // and reused across that restart; a page mounted anew (a later visit, a revisit after a sign-out
  // or after a failed exchange) asks afresh.
  const exchanges = useRef(new Map<string, Exchange>())
  const machine = useMemo(
    () =>
      createVerifyEmailMachine({
        token,
        verify: (each) => {
          const known = exchanges.current.get(each)

          if (known !== undefined) {
            return known
          }

          const exchange = service.verify(each)

          exchanges.current.set(each, exchange)

          return exchange
        },
        resend: (email) => service.resend(email),
      }),
    [service, token],
  )
  const { state, submit } = useScreenMachine(machine)
  const showForm = (['resend-offered', 'resending', 'sent'] as const).some((name) =>
    state.matches(name),
  )

  return (
    <VerifyEmailView
      verifying={state.matches('verifying')}
      message={state.context.message}
      error={state.context.error}
      showForm={showForm}
      canResend={state.can({ type: 'user.verify-email.resend-button', email: '' })}
      onResend={(email) => submit({ type: 'user.verify-email.resend-button', email })}
      link={RouterLink}
    />
  )
}
