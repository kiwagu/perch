import { useNavigate } from '@tanstack/react-router'
import { useMachine } from '@xstate/react'
import { useEffect, useMemo, useState } from 'react'

import { useT } from '@workspace/i18n'

import { useService } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { HOME_PATH } from '../../../../../platform/router'
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
  const [state, send] = useMachine(machine)
  const navigate = useNavigate()
  const notify = useNotify()
  const t = useT()
  const done = state.matches('done')
  const busy = done || state.matches('submitting')

  useEffect(() => {
    if (notice) {
      session.clearNotice()
    }
  }, [notice, session])

  // Another tab signed someone in (one account per browser): the page follows it to the profile,
  // unless the sign-in is this page's own, which goes on to its welcome.
  useEffect(
    () =>
      session.subscribe((user) => {
        if (user && !busy) {
          void navigate({ to: HOME_PATH })
        }
      }),
    [session, busy, navigate],
  )

  useEffect(() => {
    if (done) {
      notify({ testId: 'user.sign-in.notice', text: t('user.sign-in.welcome') })
      void navigate({ to: HOME_PATH })
    }
  }, [done, notify, navigate, t])

  return (
    <SignInView
      mode={state.context.mode}
      submitting={state.matches('submitting')}
      error={state.context.error}
      notice={notice}
      onSubmit={(form) => send({ type: 'SUBMIT', form })}
      onToggleMode={() => send({ type: 'TOGGLE_MODE' })}
    />
  )
}
