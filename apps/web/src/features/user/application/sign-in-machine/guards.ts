import { assertEvent } from 'xstate'

import { failureOf } from '../../../../platform/actor-outcome'
import type { Passwords } from '../../domain/password-confirmation.rule'
import { newPasswordGuards } from '../new-password-guards.policy'

import { UNKNOWN_FAILURE } from './context'
import type { SignInEvent } from './events'
import { outcomeOf } from './outcome'

/** What a guard of the flow reads: the event that is judged. */
interface GuardArgs {
  readonly event: SignInEvent
}

/** The failures that end the code step: the sign-in starts again from the password. */
const CODE_STEP_ENDED: ReadonlySet<string> = new Set([
  'data:CODE_EXPIRED',
  'data:ACCOUNT_BANNED',
  'data:RATE_LIMITED',
  'data:OTHER_ACCOUNT',
])

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
 * for an email not verified yet (the gateway's 403 that names no ban; a banned account's is
 * `data:ACCOUNT_BANNED`, which goes back to the form like any other refusal), whether it was
 * refused at the account's limit of devices (`data:DEVICE_LIMIT`), whether it
 * found the account's second factor on, so that a code is asked (its outcome `code-required`),
 * whether the code step failed in a way that ends it, and those of a new password typed twice at
 * sign-up.
 */
export const signInGuards = {
  emailNotVerified: ({ event }: GuardArgs) =>
    failureOf(event, UNKNOWN_FAILURE) === 'data:EMAIL_NOT_VERIFIED',
  atDeviceLimit: ({ event }: GuardArgs) =>
    failureOf(event, UNKNOWN_FAILURE) === 'data:DEVICE_LIMIT',
  codeRequired: ({ event }: GuardArgs) => outcomeOf(event)?.kind === 'code-required',
  codeStepEnded: ({ event }: GuardArgs) => CODE_STEP_ENDED.has(failureOf(event, UNKNOWN_FAILURE)),
  ...newPasswordGuards(passwordsOf),
}
