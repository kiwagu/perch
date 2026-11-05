import { errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type AuthUser, type DataErrorCode, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { EmailVerified } from '../../../platform/session.port'

import type { SignInError } from './sign-in.service'
import { createVerifyEmailMachine } from './verify-email.machine'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

const signedIn: EmailVerified = { kind: 'signed-in', user: ann, name: 'Ann', locale: 'en' }

const verifiedBefore: EmailVerified = { kind: 'verified-before' }

const refused = (code: DataErrorCode): ResultAsync<never, SignInError> =>
  errAsync(dataError(code, 'refused'))

const RESEND = 'user.verify-email.resend-button'

/** A result that answers once the test says what. */
function pending<T>() {
  let answer: (result: Result<T, SignInError>) => void = () => {}
  const result = new ResultAsync<T, SignInError>(
    new Promise((resolve) => {
      answer = resolve
    }),
  )

  return { result, answer: (outcome: Result<T, SignInError>) => answer(outcome) }
}

/** A verify page on the link's `token`: its machine, what it asked and what it emitted. */
function page(
  answers: {
    readonly verify?: () => ResultAsync<EmailVerified, SignInError>
    readonly resend?: () => ResultAsync<void, SignInError>
  } = {},
) {
  const verify = vi.fn((_token: string) => (answers.verify ?? (() => okAsync(signedIn)))())
  const resend = vi.fn((_email: string) => (answers.resend ?? (() => okAsync(undefined)))())
  const actor = createActor(createVerifyEmailMachine({ token: 'the-token', verify, resend }))
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))
  actor.start()

  return { actor, verify, resend, emitted }
}

/** The page once its link is refused: the error, with the form that sends a new one. */
async function offered(resend?: () => ResultAsync<void, SignInError>) {
  const opened = page({ verify: () => refused('data:LINK_INVALID'), ...(resend ? { resend } : {}) })

  await waitFor(opened.actor, (state) => state.matches('resend-offered'))

  return opened
}

describe('verify-email machine', () => {
  it('exchanges the token of the link as it starts, holding the resend while it does', () => {
    const { actor, verify } = page({ verify: () => pending<EmailVerified>().result })

    expect(actor.getSnapshot().value).toBe('verifying')
    expect(verify).toHaveBeenCalledExactlyOnceWith('the-token')
    expect(actor.getSnapshot().can({ type: RESEND, email: ann.email })).toBe(false)
  })

  it('welcomes a first verification on the frame and moves to the profile', async () => {
    const { actor, emitted } = page()
    const done = await waitFor(actor, (state) => state.status === 'done')

    expect(done.value).toBe('done')
    expect(done.context).toEqual({ error: undefined, message: undefined })
    expect(emitted).toEqual([
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: '/me' },
    ])
  })

  it('says a link verified before is verified, and ends there, signing nothing in', async () => {
    const { actor, emitted } = page({ verify: () => okAsync(verifiedBefore) })
    const verified = await waitFor(actor, (state) => state.status === 'done')

    expect(verified.value).toBe('verified')
    expect(verified.context).toEqual({ error: undefined, message: 'verified-before' })
    expect(emitted).toEqual([])
  })

  it.each([
    'data:LINK_INVALID',
    'data:LINK_EXPIRED',
    'data:OTHER_ACCOUNT',
    'data:RATE_LIMITED',
    'data:OFFLINE',
  ] as const)(
    'offers to send a new link when the exchange fails with %s, keeping its code',
    async (code) => {
      const { actor, emitted } = page({ verify: () => refused(code) })
      const failed = await waitFor(actor, (state) => state.matches('resend-offered'))

      expect(failed.context).toEqual({ error: code, message: undefined })
      expect(failed.can({ type: RESEND, email: ann.email })).toBe(true)
      expect(emitted).toEqual([])
    },
  )

  it('keeps an unknown code for a failure that carries none', async () => {
    const { actor } = page({
      verify: () => new ResultAsync<EmailVerified, SignInError>(Promise.reject(new Error('boom'))),
    })
    const failed = await waitFor(actor, (state) => state.matches('resend-offered'))

    expect(failed.context.error).toBe('verify-email:UNKNOWN')
  })

  it('sends a new link to the email typed: the error goes, the message asks to check the mail, and another can go', async () => {
    const sending = pending<void>()
    const { actor, resend } = await offered(() => sending.result)

    actor.send({ type: RESEND, email: ann.email })

    expect(actor.getSnapshot().value).toBe('resending')
    expect(actor.getSnapshot().can({ type: RESEND, email: ann.email })).toBe(false)
    expect(resend).toHaveBeenCalledExactlyOnceWith(ann.email)

    sending.answer(ok(undefined))

    const sent = await waitFor(actor, (state) => state.matches('sent'))

    // The address it went to stays with the message, whatever the field holds later.
    expect(sent.context).toStrictEqual({
      error: undefined,
      message: 'check-your-mail',
      sentTo: ann.email,
    })
    expect(sent.can({ type: RESEND, email: ann.email })).toBe(true)
  })

  it('says why a new link was not sent, and a message of an earlier resend goes', async () => {
    const answers: Array<ResultAsync<void, SignInError>> = [
      okAsync(undefined),
      refused('data:RATE_LIMITED'),
    ]
    const { actor, resend } = await offered(
      () => answers.shift() ?? expect.unreachable('a third resend'),
    )

    actor.send({ type: RESEND, email: ann.email })
    await waitFor(actor, (state) => state.matches('sent'))
    actor.send({ type: RESEND, email: ann.email })

    const failed = await waitFor(actor, (state) => state.matches('resend-offered'))

    expect(failed.context).toStrictEqual({
      error: 'data:RATE_LIMITED',
      message: undefined,
      sentTo: undefined,
    })
    expect(resend).toHaveBeenCalledTimes(2)
  })
})
