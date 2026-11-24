import { useEffect, useMemo, useState } from 'react'

import { useLocale } from '@workspace/i18n'

import { useFieldClears } from '../../../../../platform/field-clears'
import { useService } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { useSearchStart } from '../../../../../platform/search-start'
import { SESSION } from '../../../../../platform/session.port'
import { SIGN_IN_SERVICE } from '../../../application/sign-in.service'
import { createSignInMachine } from '../../../application/sign-in-machine'

import { SignInView } from './sign-in.view'

/** The anchor whose event a keystroke in a password field is. */
const PASSWORD_INPUTS = {
  password: 'user.sign-in.password-input',
  confirmation: 'user.sign-in.password-confirmation-input',
} as const

/** The anchor of the field the code of the second factor is typed in. */
const CODE_INPUT = 'user.sign-in.code.code-input'

/**
 * The sign-in page: its flow run as its machine, the email field starting with the email the
 * address carries (`{ search: email }`), the word left for it read once. Another tab's sign-in
 * takes it to the profile through the router's guard; its own goes on to its welcome. The code of
 * the second factor is typed here and emptied as the flow clears it.
 */
export function SignInContainer() {
  const service = useService(SIGN_IN_SERVICE)
  const session = useService(SESSION)
  const startEmail = useSearchStart('email')
  // The word left for the page stays on it while it is open, and only once.
  const [notice] = useState(() => session.notice())
  const machine = useMemo(() => createSignInMachine(service), [service])
  const { state, send, submit, actor, renders, can } = useScreenMachine('user.sign-in', machine)
  const locale = useLocale()
  const [code, setCode] = useState('')
  // The mode sign-up is where the state renders the fields of a new account, sign-in elsewhere
  // (asking to check the mail and offering the resend among them, the values kept, and done,
  // which only a sign-in reaches).
  const mode = renders('user.sign-in.name-input') ? 'sign-up' : 'sign-in'

  useFieldClears(actor, { [CODE_INPUT]: () => setCode('') })

  useEffect(() => {
    if (notice) {
      session.clearNotice()
    }
  }, [notice, session])

  return (
    <SignInView
      startEmail={startEmail}
      mode={mode}
      error={state.context.error}
      notice={notice}
      mail={state.context.mail}
      sentTo={state.context.sentTo}
      renders={renders}
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
      onForgot={(email) =>
        send({ type: 'user.sign-in.forgot-link', fields: { 'user.sign-in.email-input': email } })
      }
      onConfirmDeviceLimit={() => send({ type: 'user.sign-in.device-limit-dialog.confirm-button' })}
      onCancelDeviceLimit={() => send({ type: 'user.sign-in.device-limit-dialog.cancel-button' })}
      code={code}
      codeError={state.context.codeError}
      onTypeCode={setCode}
      onConfirmCode={() => send({ type: 'user.sign-in.code.dialog.confirm-button', code })}
      onCancelCode={() => send({ type: 'user.sign-in.code.dialog.cancel-button' })}
      onPasskey={() => send({ type: 'user.sign-in.passkey-button' })}
    />
  )
}
