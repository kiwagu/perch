import { useEffect, useMemo, useState } from 'react'

import { useLocale } from '@workspace/i18n'

import { useLeaveNow } from '../../../../../platform/leave-now'
import { useService } from '../../../../../platform/module'
import { HOME_PATH } from '../../../../../platform/router'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { SIGN_IN_SERVICE } from '../../../application/sign-in.service'
import { createSignInMachine } from '../../../application/sign-in-machine'

import { type SignInControl, SignInView } from './sign-in.view'

/** The anchor whose event a keystroke in a password field is. */
const PASSWORD_INPUTS = {
  password: 'user.sign-in.password-input',
  confirmation: 'user.sign-in.password-confirmation-input',
} as const

export function SignInContainer() {
  const service = useService(SIGN_IN_SERVICE)
  const session = useService(SESSION)
  // The word the last session left stays on the page while it is open, and only once.
  const [notice] = useState(() => session.notice())
  const machine = useMemo(() => createSignInMachine(service), [service])
  const { state, send, submit, actor } = useScreenMachine(machine)
  const leaveNow = useLeaveNow()
  const locale = useLocale()
  const submitting = (['signing-in', 'signing-up', 'resending'] as const).some((name) =>
    state.matches(name),
  )
  const done = state.matches('done')
  const busy = submitting || done
  // The mode is the state: sign-up only while creating an account (the password breaking a rule
  // and the passwords differing among them), sign-in otherwise (asking to check the mail and
  // offering the resend among them, the values kept, and done, which only a sign-in reaches).
  const mode = (['sign-up', 'password-weak', 'passwords-differ', 'signing-up'] as const).some(
    (name) => state.matches(name),
  )
    ? 'sign-up'
    : 'sign-in'
  const showResend = (['check-mail', 'unverified', 'resending'] as const).some((name) =>
    state.matches(name),
  )
  // Whether the state handles a button's event; what the event carries does not decide it.
  const can = (control: SignInControl) =>
    state.can(
      control === 'user.sign-in.submit-button'
        ? { type: control, form: { email: '', password: '', name: '', locale }, confirmation: '' }
        : { type: control, email: '' },
    )

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
      error={state.context.error}
      notice={notice}
      mail={state.context.mail}
      sentTo={state.context.sentTo}
      showResend={showResend}
      can={can}
      // The password typed again goes beside the form, never in it. A submit that finds the two
      // differing asks for nothing, so what was typed stays unsaved.
      onSubmit={({ confirmation, ...form }) =>
        submit({
          type: 'user.sign-in.submit-button',
          form: { ...form, locale },
          confirmation,
        }).then((saved) => saved && !actor.getSnapshot().matches('passwords-differ'))
      }
      onToggleMode={(passwords) => send({ type: 'user.sign-in.toggle-button', ...passwords })}
      onTypePassword={(field, passwords) => send({ type: PASSWORD_INPUTS[field], ...passwords })}
      onResend={(email) => submit({ type: 'user.sign-in.resend-button', email })}
    />
  )
}
