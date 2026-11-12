import { keepsPasswordRules } from '@workspace/kernel'

import { checkPasswordConfirmation, type Passwords } from '../domain/password-confirmation.rule'

/** What a guard of a flow reads: the event that is judged. */
interface GuardArgs<TEvent> {
  readonly event: TEvent
}

/**
 * The guards of a form that sets a new password typed twice (a sign-up, a reset, a change), by
 * the names its flow gives them: whether the new password breaks a rule of a new password (the
 * kernel's rule, the gateway's too), and three readings of the password typed again, as
 * `passwordsOf` reads both from the event judged.
 */
export function newPasswordGuards<TEvent>(passwordsOf: (event: TEvent) => Passwords) {
  const confirmationOf = (event: TEvent) => checkPasswordConfirmation(passwordsOf(event))

  return {
    passwordBreaksRules: ({ event }: GuardArgs<TEvent>) =>
      !keepsPasswordRules(passwordsOf(event).password),
    passwordsDiffer: ({ event }: GuardArgs<TEvent>) => confirmationOf(event) !== 'same',
    confirmationStrays: ({ event }: GuardArgs<TEvent>) => confirmationOf(event) === 'strayed',
    confirmationFollows: ({ event }: GuardArgs<TEvent>) => confirmationOf(event) !== 'strayed',
  }
}
