import { assertEvent } from 'xstate'

import { keepsPasswordRules } from '@workspace/kernel'

import { failureOf } from '../../../../platform/actor-outcome'
import {
  checkPasswordConfirmation,
  type PasswordConfirmation,
  type Passwords,
} from '../../domain/password-confirmation.rule'

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

/** How the password typed again stands to the password, as the event carries both. */
const confirmationOf = (event: SignInEvent): PasswordConfirmation =>
  checkPasswordConfirmation(passwordsOf(event))

/**
 * The guards of the screen's flow, by the names of its `meta.guards`: whether a sign-in was refused
 * for an email not verified yet, whether the password breaks a rule of a new password (the
 * kernel's rule, the gateway's too), and three readings of the password typed again.
 */
export const signInGuards = {
  emailNotVerified: ({ event }: GuardArgs) =>
    failureOf(event, UNKNOWN_FAILURE) === 'data:EMAIL_NOT_VERIFIED',
  passwordBreaksRules: ({ event }: GuardArgs) => !keepsPasswordRules(passwordsOf(event).password),
  passwordsDiffer: ({ event }: GuardArgs) => confirmationOf(event) !== 'same',
  confirmationStrays: ({ event }: GuardArgs) => confirmationOf(event) === 'strayed',
  confirmationFollows: ({ event }: GuardArgs) => confirmationOf(event) !== 'strayed',
}
