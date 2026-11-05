import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type DataErrorCode, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { EmailConfirmed } from '../../../platform/session.port'

import { createConfirmEmailMachine } from './confirm-email.machine'
import type { SignInError } from './sign-in.service'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

const confirmed: EmailConfirmed = { identity: ann, email: 'ann.new@example.test' }

/** The page of the link `the-token`, with `here` signed in on the device. */
function page(
  here: string | undefined,
  answer: () => ResultAsync<EmailConfirmed, SignInError> = () => okAsync(confirmed),
) {
  const confirm = vi.fn((_token: string) => answer())
  const actor = createActor(
    createConfirmEmailMachine({ token: 'the-token', confirm, current: () => here }),
  ).start()

  return { actor, confirm }
}

describe('the confirm-email page', () => {
  it('confirms the token of its address at once', () => {
    const { actor, confirm } = page(undefined)

    expect(actor.getSnapshot().value).toBe('confirming')
    expect(confirm).toHaveBeenCalledWith('the-token')
  })

  it.each([
    ['this account', ann, 'done-here'],
    ['nobody', undefined, 'done'],
    ['another account', bob, 'done-elsewhere'],
  ])('says the email is the new one, ending by who is signed in here: %s', async (_, here, end) => {
    const { actor } = page(here)
    const done = await waitFor(actor, (state) => state.status === 'done')

    expect(done.value).toBe(end)
    expect(done.context).toEqual({ error: undefined, message: 'email-changed' })
  })

  it.each([
    'data:LINK_INVALID',
    'data:LINK_EXPIRED',
    'data:RATE_LIMITED',
    'data:OFFLINE',
  ] as const satisfies readonly DataErrorCode[])(
    'ends on the error of a refused link: %s',
    async (code) => {
      const { actor } = page(ann, () => errAsync(dataError(code, 'refused')))
      const failed = await waitFor(actor, (state) => state.status === 'done')

      expect(failed.value).toBe('failed')
      expect(failed.context).toEqual({ error: code, message: undefined })
    },
  )
})
