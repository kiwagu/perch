import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type AuthUser, dataError } from '@workspace/data'

import type { Passwords } from '../domain/password-confirmation.rule'

import { createSignInMachine, type SignInEvent } from './sign-in.machine'
import type { SignInError, SignInForm } from './sign-in.service'

const ann: SignInForm = {
  email: 'ann@example.test',
  password: 'secret-ann',
  name: 'Ann',
  locale: 'en',
}

/** The code the form's error keeps while the password typed again differs. */
const PASSWORDS_DIFFER = 'sign-in:PASSWORDS_DIFFER'

/** A form whose sign-up goes through, recording each form it signs up; nothing else is asked here. */
function signingUp() {
  const signedUp: SignInForm[] = []
  const actor = createActor(
    createSignInMachine({
      signIn: () =>
        errAsync<AuthUser, SignInError>(dataError('data:AUTH_FAILED', 'not in this test')),
      signUp: (form) => {
        signedUp.push(form)

        return okAsync(undefined)
      },
      resend: () => okAsync(undefined),
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))
  actor.send({ type: 'user.sign-in.toggle-button' })

  return { actor, signedUp, emitted }
}

/** A keystroke in the password, with both passwords as they are after it. */
const inPassword = (passwords: Passwords): SignInEvent => ({
  type: 'user.sign-in.password-input',
  ...passwords,
})

/** A keystroke in the password typed again, with both passwords as they are after it. */
const inConfirmation = (passwords: Passwords): SignInEvent => ({
  type: 'user.sign-in.password-confirmation-input',
  ...passwords,
})

/** The submit of Ann's form, with the password typed again as `confirmation`. */
const submitted = (confirmation: string): SignInEvent => ({
  type: 'user.sign-in.submit-button',
  form: ann,
  confirmation,
})

describe('the password typed again at sign-up', () => {
  it('lets the form be while it is typed as the password begins, nothing typed yet included', () => {
    const { actor, emitted } = signingUp()

    actor.send(inPassword({ password: ann.password, confirmation: '' }))

    for (let typed = 0; typed < ann.password.length; typed += 1) {
      actor.send(
        inConfirmation({ password: ann.password, confirmation: ann.password.slice(0, typed) }),
      )

      expect(actor.getSnapshot()).toMatchObject({ value: 'sign-up', context: { error: undefined } })
    }

    expect(emitted).toEqual([])
  })

  it.each([
    ['a character differs', 'secret-b'],
    ['it is longer', 'secret-ann!'],
  ])('says the passwords differ once %s', (_, confirmation) => {
    const { actor, emitted } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
    // The form keeps the code for its own error: the host is asked nothing.
    expect(emitted).toEqual([])
  })

  it('says so when the password is edited under a password typed again', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: ann.password }))
    expect(actor.getSnapshot().value).toBe('sign-up')

    actor.send(inPassword({ password: 'secret-anx', confirmation: ann.password }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
  })

  it.each([
    [
      'the password typed again is cut back to how the password begins',
      inConfirmation({ password: ann.password, confirmation: 'secret' }),
    ],
    [
      'the password typed again is emptied',
      inConfirmation({ password: ann.password, confirmation: '' }),
    ],
    [
      'the password is edited to begin with the password typed again',
      inPassword({ password: 'secret-b-c', confirmation: 'secret-b' }),
    ],
  ])('goes back to sign-up, the error cleared, once %s', (_, follows) => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-b' }))
    expect(actor.getSnapshot().value).toBe('passwords-differ')

    actor.send(follows)

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-up', context: { error: undefined } })
  })

  it('stays where it is while the password typed again goes on straying', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-b' }))
    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-bc' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
  })

  it('asks for no account when only a part of the password was typed again, and takes no submit until the two agree', () => {
    const { actor, signedUp } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-an' }))
    actor.send(submitted('secret-an'))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: PASSWORDS_DIFFER },
    })
    expect(actor.getSnapshot().can(submitted(ann.password))).toBe(false)

    actor.send(submitted(ann.password))

    expect(actor.getSnapshot().value).toBe('passwords-differ')
    expect(signedUp).toEqual([])
  })

  it('signs up once the two are the same, sending the form without the password typed again', async () => {
    const { actor, signedUp } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-b' }))
    actor.send(inConfirmation({ password: ann.password, confirmation: ann.password }))
    expect(actor.getSnapshot().can(submitted(ann.password))).toBe(true)

    actor.send(submitted(ann.password))

    expect(actor.getSnapshot().value).toBe('signing-up')
    expect((await waitFor(actor, (state) => state.matches('check-mail'))).context.error).toBe(
      undefined,
    )
    expect(signedUp).toStrictEqual([ann])
  })

  it('goes to sign-in on the toggle, the error cleared, and back to sign-up on the next', () => {
    const { actor } = signingUp()

    actor.send(inConfirmation({ password: ann.password, confirmation: 'secret-b' }))
    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })

    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot().value).toBe('sign-up')
  })

  it('compares nothing in the mode sign-in', () => {
    const { actor } = signingUp()

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send(inPassword({ password: 'secret-b', confirmation: ann.password }))

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })
  })
})
