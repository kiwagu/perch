import { useEffect, useMemo, useState } from 'react'

import { useLocale } from '@workspace/i18n'

import { useLeaveNow } from '../../../../../platform/leave-now'
import { useService } from '../../../../../platform/module'
import { HOME_PATH } from '../../../../../platform/router'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { createSignInMachine } from '../../../application/sign-in.machine'
import { SIGN_IN_SERVICE } from '../../../application/sign-in.service'

import { SignInView } from './sign-in.view'

export function SignInContainer() {
  const service = useService(SIGN_IN_SERVICE)
  const session = useService(SESSION)
  // The word the last session left stays on the page while it is open, and only once.
  const [notice] = useState(() => session.notice())
  const machine = useMemo(() => createSignInMachine(service), [service])
  const { state, send, submit } = useScreenMachine(machine)
  const leaveNow = useLeaveNow()
  const locale = useLocale()
  const submitting = (['signing-in', 'signing-up', 'resending'] as const).some((name) =>
    state.matches(name),
  )
  const done = state.matches('done')
  const busy = submitting || done
  // The mode is the state: sign-up only while creating an account, sign-in otherwise (asking to
  // check the mail and offering the resend among them, the values kept, and done, which only a
  // sign-in reaches).
  const mode = state.matches('sign-up') || state.matches('signing-up') ? 'sign-up' : 'sign-in'
  const showResend = (['check-mail', 'unverified', 'resending'] as const).some((name) =>
    state.matches(name),
  )
  const canResend = state.can({ type: 'user.sign-in.resend-button', email: '' })

  useEffect(() => {
    if (notice) {
      session.clearNotice()
    }
  }, [notice, session])

  // Another tab signed someone in (one account per browser): the page follows it to the profile,
  // unless the sign-in is this page's own, which goes on to its welcome. Nobody started that leave
  // here, so it passes the frame's guard: what was typed cannot be kept.
  useEffect(
    () =>
      session.subscribe((user) => {
        if (user && !busy) {
          leaveNow(HOME_PATH)
        }
      }),
    [session, busy, leaveNow],
  )

  return (
    <SignInView
      mode={mode}
      submitting={submitting}
      error={state.context.error}
      notice={notice}
      mail={state.context.mail}
      showResend={showResend}
      canResend={canResend}
      onSubmit={(form) => submit({ type: 'user.sign-in.submit-button', form: { ...form, locale } })}
      onToggleMode={() => send({ type: 'user.sign-in.toggle-button' })}
      onResend={(email) => submit({ type: 'user.sign-in.resend-button', email })}
    />
  )
}
