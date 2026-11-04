import { useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'

import { z } from '@workspace/zod'

import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { createResetPasswordMachine } from '../../../application/reset-password.machine'
import { RouterLink } from '../../components/page-link/page-link'

import { ResetPasswordView } from './reset-password.view'

/** The search of the address, which the route's own schema checked already. */
const search = z.object({ token: z.string().optional() })

/**
 * The page a reset mail's link opens, over the token its address names (none is an empty one,
 * which the session refuses as a link that does not work, asking nobody). Another token in the
 * address while the page is open starts afresh with its own machine. The page is open whoever is
 * signed in: a reset of this device's own account signs it out (its channel hears 4002), and the
 * page keeps its message, which its machine holds whatever the session does.
 */
export function ResetPasswordContainer() {
  const { token = '' } = search.parse(useSearch({ strict: false }))

  return <ResetForm key={token} token={token} />
}

/** The screen's flow run as its machine over one token. */
function ResetForm(props: { readonly token: string }) {
  const session = useService(SESSION)
  const machine = useMemo(
    () =>
      createResetPasswordMachine({
        token: props.token,
        reset: (token, password) => session.resetPassword(token, password),
      }),
    [session, props.token],
  )
  const { state, send, submit, actor, renders } = useScreenMachine('user.reset-password', machine)

  return (
    <ResetPasswordView
      message={state.context.message}
      error={state.context.error}
      renders={renders}
      canSubmit={state.can({
        type: 'user.reset-password.submit-button',
        password: '',
        confirmation: '',
      })}
      onTypePassword={(field, passwords) =>
        send(
          field === 'password'
            ? { type: 'user.reset-password.password-input', ...passwords }
            : { type: 'user.reset-password.password-confirmation-input', ...passwords },
        )
      }
      // A submit that finds the two differing asks for nothing, so what was typed stays unsaved.
      onSubmit={(passwords) =>
        submit({ type: 'user.reset-password.submit-button', ...passwords }).then(
          (saved) => saved && !actor.getSnapshot().matches('passwords-differ'),
        )
      }
      link={RouterLink}
    />
  )
}
