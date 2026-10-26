import { useNavigate } from '@tanstack/react-router'
import { useMachine } from '@xstate/react'
import { useEffect, useMemo, useState } from 'react'

import { useLocale } from '@workspace/i18n'

import { useService } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import { HOME_PATH } from '../../../../../platform/router'
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
  const [state, send, actor] = useMachine(machine)
  const navigate = useNavigate()
  const notify = useNotify()
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

  // The effects of the flow outside the form: the welcome on the shell's notice, then the move.
  useEffect(() => {
    const shown = actor.on('show', ({ codes }) => {
      if (codes.includes('welcome')) {
        notify({ code: 'welcome', text: (t) => t('user.sign-in.welcome') })
      }
    })
    const moved = actor.on('navigate', ({ to }) => void navigate({ to }))

    return () => {
      shown.unsubscribe()
      moved.unsubscribe()
    }
  }, [actor, notify, navigate])

  return (
    <SignInView
      mode={mode}
      submitting={submitting}
      error={state.context.error}
      notice={notice}
      onSubmit={(form) => send({ type: 'user.sign-in.submit-button', form: { ...form, locale } })}
      onToggleMode={() => send({ type: 'user.sign-in.toggle-button' })}
    />
  )
}
