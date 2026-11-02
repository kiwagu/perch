import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type DataErrorCode, dataError } from '@workspace/data'

import type { Passwords } from '../domain/password-confirmation.rule'

import {
  createResetPasswordMachine,
  RESET_PASSWORDS_DIFFER,
  type ResetPasswordEvent,
} from './reset-password.machine'
import type { SignInError } from './sign-in.service'

/** A new password that keeps the rules of a new password. */
const NEW = 'Secret-new1'

/** The page of the link `the-token`, over a reset that answers as `answer` says. */
function page(answer: () => ResultAsync<void, SignInError> = () => okAsync(undefined)) {
  const reset = vi.fn((_token: string, _password: string) => answer())
  const actor = createActor(createResetPasswordMachine({ token: 'the-token', reset })).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, reset, emitted }
}

const inPassword = (passwords: Passwords): ResetPasswordEvent => ({
  type: 'user.reset-password.password-input',
  ...passwords,
})

const inConfirmation = (passwords: Passwords): ResetPasswordEvent => ({
  type: 'user.reset-password.password-confirmation-input',
  ...passwords,
})

const submitted = (passwords: Passwords): ResetPasswordEvent => ({
  type: 'user.reset-password.submit-button',
  ...passwords,
})

const refused = (code: DataErrorCode) => () => errAsync(dataError(code, 'refused'))

/** The page with the new password typed twice, ready to submit. */
function typedTwice(answer?: () => ResultAsync<void, SignInError>) {
  const opened = page(answer)

  opened.actor.send(inPassword({ password: NEW, confirmation: '' }))
  opened.actor.send(inConfirmation({ password: NEW, confirmation: NEW }))

  return opened
}

describe('the reset page', () => {
  it('holds the submit while the password breaks a rule, judging no password typed again', () => {
    const { actor } = page()

    for (const password of ['', 'abcdefghij', 'Secret new1']) {
      actor.send(inPassword({ password, confirmation: 'x' }))

      expect(actor.getSnapshot()).toMatchObject({
        value: 'password-weak',
        context: { error: undefined },
      })
      expect(actor.getSnapshot().can(submitted({ password, confirmation: password }))).toBe(false)
    }
  })

  it('says the passwords differ once the password typed again strays, and lets go once it follows', () => {
    const { actor } = page()

    actor.send(inPassword({ password: NEW, confirmation: '' }))
    expect(actor.getSnapshot().value).toBe('kept')

    actor.send(inConfirmation({ password: NEW, confirmation: 'Secret-x' }))
    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: RESET_PASSWORDS_DIFFER },
    })
    expect(actor.getSnapshot().can(submitted({ password: NEW, confirmation: NEW }))).toBe(false)

    actor.send(inConfirmation({ password: NEW, confirmation: 'Secret' }))
    expect(actor.getSnapshot()).toMatchObject({ value: 'kept', context: { error: undefined } })
  })

  it('sends nothing when only a part of the password was typed again', () => {
    const { actor, reset } = page()

    actor.send(inPassword({ password: NEW, confirmation: '' }))
    actor.send(submitted({ password: NEW, confirmation: 'Secret' }))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'passwords-differ',
      context: { error: RESET_PASSWORDS_DIFFER },
    })
    expect(reset).not.toHaveBeenCalled()
  })

  it('sets the password with the token of its address, never the password typed again, and says so', async () => {
    const { actor, reset, emitted } = typedTwice()

    actor.send(submitted({ password: NEW, confirmation: NEW }))

    const done = await waitFor(actor, (state) => state.matches('done'))

    expect(reset).toHaveBeenCalledWith('the-token', NEW)
    expect(done.status).toBe('done')
    expect(done.context).toEqual({ error: undefined, message: 'password-reset' })
    expect(emitted).toEqual([])
  })

  it.each([
    ['data:LINK_INVALID', 'link-dead'],
    ['data:LINK_EXPIRED', 'link-dead'],
    ['data:PASSWORD_REJECTED', 'kept'],
    ['data:RATE_LIMITED', 'kept'],
    ['data:OFFLINE', 'kept'],
  ] as const)(
    'ends on a link that does not work, else keeps the form as typed: %s',
    async (code, at) => {
      const { actor } = typedTwice(refused(code))

      actor.send(submitted({ password: NEW, confirmation: NEW }))

      const after = await waitFor(actor, (state) => state.matches(at))

      expect(after.context.error).toBe(code)
      expect(after.can(submitted({ password: NEW, confirmation: NEW }))).toBe(at === 'kept')
    },
  )

  it('clears the error of the last attempt as the next one starts', async () => {
    let refuse = true
    const { actor } = typedTwice(() =>
      refuse ? refused('data:RATE_LIMITED')() : okAsync(undefined),
    )

    actor.send(submitted({ password: NEW, confirmation: NEW }))
    await waitFor(actor, (state) => state.context.error === 'data:RATE_LIMITED')

    refuse = false
    actor.send(submitted({ password: NEW, confirmation: NEW }))

    expect(actor.getSnapshot()).toMatchObject({ value: 'resetting', context: { error: undefined } })
    await waitFor(actor, (state) => state.matches('done'))
  })
})
