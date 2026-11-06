import { assertEvent } from 'xstate'

import { failureOf } from '../../../../platform/actor-outcome'
import type { Passwords } from '../../domain/password-confirmation.rule'
import { newPasswordGuards } from '../new-password-guards.policy'

import { UNKNOWN_FAILURE } from './context'
import type { SignInEvent } from './events'

/** What a guard of the flow reads: the event that is judged. */
interface GuardArgs {
  readonly event: SignInEvent
}

/** The passwords an event carries as typed: the submit's from its form, the others' as they are. */
function passwordsOf(event: SignInEvent): Passwords {
  assertEvent(event, [
    'user.sign-in.toggle-button',
    'user.sign-in.submit-button',
    'user.sign-in.password-input',
    'user.sign-in.password-confirmation-input',
  ])

  return event.type === 'user.sign-in.submit-button'
    ? { password: event.form.password, confirmation: event.confirmation }
    : { password: event.password, confirmation: event.confirmation }
}

/**
 * The guards of the screen's flow, by the names of its `meta.guards`: whether a sign-in was refused
 * for an email not verified yet, whether it found the account signed in on as many devices as it
 * may be (its outcome `device-limit`), and those of a new password typed twice at sign-up.
 */
export const signInGuards = {
  emailNotVerified: ({ event }: GuardArgs) =>
    failureOf(event, UNKNOWN_FAILURE) === 'data:EMAIL_NOT_VERIFIED',
  atDeviceLimit: ({ event }: GuardArgs) => {
    const output = 'output' in event ? event.output : undefined

    return (
      typeof output === 'object' &&
      output !== null &&
      'kind' in output &&
      output.kind === 'device-limit'
    )
  },
  ...newPasswordGuards(passwordsOf),
}
