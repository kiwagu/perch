import { useEffect, useMemo, useState } from 'react'

import { useLocale } from '@workspace/i18n'

import { useLeaveNow } from '../../../../../platform/leave-now'
import { useService } from '../../../../../platform/module'
import { HOME_PATH } from '../../../../../platform/router'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { createSignInMachine } from '../../../application/sign-in.machine'
import { SIGN_IN_SERVICE, type SignInMode } from '../../../application/sign-in.service'

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
  const submitting = state.matches('signing-in') || state.matches('signing-up')
  const done = state.matches('done')
  const busy = submitting || done
  // The mode is the state; once done, the form keeps the mode of its attempt until it moves.
  const [mode, setMode] = useState<SignInMode>('sign-in')
  const shown = state.matches('sign-up') || state.matches('signing-up') ? 'sign-up' : 'sign-in'

  if (!done && shown !== mode) {
    setMode(shown)
  }

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
      onSubmit={(form) => submit({ type: 'user.sign-in.submit-button', form: { ...form, locale } })}
      onToggleMode={() => send({ type: 'user.sign-in.toggle-button' })}
    />
  )
}
