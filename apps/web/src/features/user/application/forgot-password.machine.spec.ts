import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { dataError } from '@workspace/data'

import { createForgotPasswordMachine } from './forgot-password.machine'
import type { SignInError } from './sign-in.service'

const SEND = 'user.forgot-password.send-button'
const RESET = 'platform.password-reset'
const EMAIL = 'user.forgot-password.email-input'

/** The page over a request that answers as `answer` says, recording each email it asks for. */
function page(answer: () => ResultAsync<void, SignInError> = () => okAsync(undefined)) {
  const request = vi.fn((_email: string) => answer())
  const actor = createActor(createForgotPasswordMachine({ request })).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, request, emitted }
}

describe('the forgot-password page', () => {
  it('asks for the mail with the email typed, and the message names where it went', async () => {
    const { actor, request, emitted } = page()

    expect(actor.getSnapshot().can({ type: SEND, email: '' })).toBe(true)

    actor.send({ type: SEND, email: 'ann@example.test' })

    expect(actor.getSnapshot().value).toBe('sending')
    expect(actor.getSnapshot().can({ type: SEND, email: '' })).toBe(false)

    const sent = await waitFor(actor, (state) => state.matches('sent'))

    expect(request).toHaveBeenCalledWith('ann@example.test')
    expect(sent.context).toEqual({
      error: undefined,
      message: 'check-your-mail',
      sentTo: 'ann@example.test',
    })
    expect(emitted).toEqual([])
  })

  it('says why the mail was not asked for, takes the message away, and asks again on the next press', async () => {
    let refuse = false
    const { actor, request } = page(() =>
      refuse ? errAsync(dataError('data:RATE_LIMITED', 'wait')) : okAsync(undefined),
    )

    actor.send({ type: SEND, email: 'ann@example.test' })
    await waitFor(actor, (state) => state.matches('sent'))

    refuse = true
    actor.send({ type: SEND, email: 'ann@example.test' })

    const refused = await waitFor(actor, (state) => state.matches('idle'))

    expect(refused.context).toEqual({
      error: 'data:RATE_LIMITED',
      message: undefined,
      sentTo: undefined,
    })

    refuse = false
    actor.send({ type: SEND, email: 'ann@example.test' })

    // The next attempt clears the error of the last one.
    expect(actor.getSnapshot().context.error).toBeUndefined()
    await waitFor(actor, (state) => state.matches('sent'))
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('follows a new password set in another tab once the mail was asked for: the sign-in page says why and starts with the email in the field', async () => {
    const { actor, emitted } = page()

    actor.send({ type: SEND, email: 'ann@example.test' })
    await waitFor(actor, (state) => state.matches('sent'))
    actor.send({ type: RESET, fields: { [EMAIL]: 'ann@example.test' } })

    expect(actor.getSnapshot().value).toBe('reset-elsewhere')
    expect(actor.getSnapshot().status).toBe('done')
    expect(emitted).toEqual([
      {
        type: 'show',
        anchor: 'user.sign-in.notice-message',
        codes: ['password-reset-elsewhere'],
      },
      {
        type: 'navigate',
        to: '/sign-in',
        search: { email: { anchor: EMAIL } },
        fields: { [EMAIL]: 'ann@example.test' },
      },
    ])
  })

  it('lets a new password set in another tab pass before the mail was asked for, and while it is', () => {
    const { actor, emitted } = page()

    actor.send({ type: RESET, fields: { [EMAIL]: '' } })

    expect(actor.getSnapshot().value).toBe('idle')

    actor.send({ type: SEND, email: 'ann@example.test' })
    actor.send({ type: RESET, fields: { [EMAIL]: 'ann@example.test' } })

    expect(actor.getSnapshot().value).toBe('sending')
    expect(emitted).toEqual([])
  })
})
