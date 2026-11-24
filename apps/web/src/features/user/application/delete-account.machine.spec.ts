import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type DataError, type DataErrorCode, dataError } from '@workspace/data'

import { createDeleteAccountMachine, type DeleteAccountEvent } from './delete-account.machine'

const PRESS = { type: 'user.delete-account.delete-button' } as const satisfies DeleteAccountEvent

/** The page of the link `the-token`, over a deletion that answers as `answer` says. */
function page(answer: () => ResultAsync<void, DataError> = () => okAsync(undefined)) {
  const deleteAccount = vi.fn((_token: string) => answer())
  const actor = createActor(
    createDeleteAccountMachine({ token: 'the-token', deleteAccount }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, deleteAccount, emitted }
}

const refused = (code: DataErrorCode) => () => errAsync(dataError(code, 'refused'))

describe('the deletion page', () => {
  it('asks first, with the button taken and nothing shown', () => {
    const { actor, deleteAccount } = page()

    expect(actor.getSnapshot()).toMatchObject({
      value: 'asking',
      context: { error: undefined, message: undefined },
    })
    expect(actor.getSnapshot().can(PRESS)).toBe(true)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the account with the token of its address once the button is pressed, and says so', async () => {
    const { actor, deleteAccount, emitted } = page()

    actor.send(PRESS)

    const done = await waitFor(actor, (state) => state.matches('done'))

    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(deleteAccount).toHaveBeenCalledWith('the-token')
    expect(done.status).toBe('done')
    expect(done.context).toEqual({ error: undefined, message: 'account-deleted' })
    expect(emitted).toEqual([])
  })

  it('takes the button no more while the deletion is under way', () => {
    const { actor, deleteAccount } = page(() =>
      ResultAsync.fromSafePromise(new Promise<void>(() => {})),
    )

    actor.send(PRESS)
    expect(actor.getSnapshot().value).toBe('deleting')
    expect(actor.getSnapshot().can(PRESS)).toBe(false)

    actor.send(PRESS)
    expect(deleteAccount).toHaveBeenCalledTimes(1)
  })

  it.each(['data:LINK_INVALID', 'data:LINK_EXPIRED'] as const)(
    'ends on a link that does not work, with its error and no button: %s',
    async (code) => {
      const { actor } = page(refused(code))

      actor.send(PRESS)

      const dead = await waitFor(actor, (state) => state.matches('link-dead'))

      expect(dead.status).toBe('done')
      expect(dead.context).toEqual({ error: code, message: undefined })
      expect(dead.can(PRESS)).toBe(false)
    },
  )

  it.each(['data:LAST_ADMIN', 'data:RATE_LIMITED', 'data:COMMAND_FAILED', 'data:OFFLINE'] as const)(
    'says why nothing was deleted and offers the button again: %s',
    async (code) => {
      const { actor } = page(refused(code))

      actor.send(PRESS)

      const after = await waitFor(actor, (state) => state.context.error !== undefined)

      expect(after.value).toBe('asking')
      expect(after.context).toEqual({ error: code, message: undefined })
      expect(after.can(PRESS)).toBe(true)
    },
  )

  it('clears the error of the last attempt as the next one starts, and deletes the second time', async () => {
    let refuse = true
    const { actor, deleteAccount } = page(() =>
      refuse ? refused('data:LAST_ADMIN')() : okAsync(undefined),
    )

    actor.send(PRESS)
    await waitFor(actor, (state) => state.context.error === 'data:LAST_ADMIN')

    refuse = false
    actor.send(PRESS)

    expect(actor.getSnapshot()).toMatchObject({ value: 'deleting', context: { error: undefined } })

    const done = await waitFor(actor, (state) => state.matches('done'))

    expect(done.context).toEqual({ error: undefined, message: 'account-deleted' })
    expect(deleteAccount).toHaveBeenCalledTimes(2)
  })
})
