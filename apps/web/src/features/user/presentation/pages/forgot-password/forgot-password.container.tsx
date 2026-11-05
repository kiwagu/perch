import { useMemo, useState } from 'react'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { useSearchStart } from '../../../../../platform/search-start'
import { SESSION } from '../../../../../platform/session.port'
import { createForgotPasswordMachine } from '../../../application/forgot-password.machine'
import { RouterLink } from '../../components/page-link/page-link'

import { ForgotPasswordView } from './forgot-password.view'

const SEND = 'user.forgot-password.send-button'

/**
 * The page that asks for the mail of a password reset: its flow run as its machine, the email
 * field starting with the email the address carries (`{ search: email }`). The page holds the
 * field's value, so a new password set in another tab moves to the sign-in page with the email
 * as typed.
 */
export function ForgotPasswordContainer() {
  const session = useService(SESSION)
  const startEmail = useSearchStart('email')
  const [email, setEmail] = useState(startEmail)
  const machine = useMemo(
    () => createForgotPasswordMachine({ request: (asked) => session.requestPasswordReset(asked) }),
    [session],
  )
  const { state, submit } = useScreenMachine('user.forgot-password', machine, {
    'user.forgot-password.email-input': email,
  })

  return (
    <ForgotPasswordView
      email={email}
      onEmailChange={setEmail}
      message={state.context.message}
      sentTo={state.context.sentTo}
      error={state.context.error}
      canSend={state.can({ type: SEND, email: '' })}
      onSend={(typed) => submit({ type: SEND, email: typed })}
      link={RouterLink}
    />
  )
}
