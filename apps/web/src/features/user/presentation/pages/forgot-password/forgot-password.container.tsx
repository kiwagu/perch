import { useMemo } from 'react'

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
 * field starting with the email the address carries (`{ search: email }`).
 */
export function ForgotPasswordContainer() {
  const session = useService(SESSION)
  const startEmail = useSearchStart('email')
  const machine = useMemo(
    () => createForgotPasswordMachine({ request: (email) => session.requestPasswordReset(email) }),
    [session],
  )
  const { state, submit } = useScreenMachine(machine)

  return (
    <ForgotPasswordView
      startEmail={startEmail}
      message={state.context.message}
      sentTo={state.context.sentTo}
      error={state.context.error}
      canSend={state.can({ type: SEND, email: '' })}
      onSend={(email) => submit({ type: SEND, email })}
      link={RouterLink}
    />
  )
}
