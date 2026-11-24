import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { waitFor } from 'xstate'

import { dataError } from '@workspace/data'
import { type PasskeyId, passkeyIdFactory } from '@workspace/ids'

import { screen } from './__fixtures__/screen'

const ADD = { type: 'user.settings.passkeys.add-button' } as const
const remove = (passkey: PasskeyId) =>
  ({ type: 'user.settings.passkeys.remove-button', passkey }) as const

const READ_LIST = { type: 'read', anchor: 'user.settings.passkeys.list' }
const toast = (code: string) => ({ type: 'show', anchor: 'app-shell.toast', codes: [code] })
const adding = (state: 'idle' | 'running') => ({ viewing: { 'passkey-add': state } }) as const
const removing = (state: 'idle' | 'running') => ({ viewing: { 'passkey-remove': state } }) as const

describe('the passkey add region', () => {
  it('has the browser make a passkey, then reads the list and says so', async () => {
    const addPasskey = vi.fn(() => okAsync(undefined))
    const settings = screen({ addPasskey })

    settings.actor.send(ADD)

    // The browser's window is open: no second one.
    expect(settings.actor.getSnapshot().can(ADD)).toBe(false)

    await waitFor(settings.actor, (state) => state.matches(adding('idle')))

    expect(addPasskey).toHaveBeenCalledTimes(1)
    expect(settings.emitted).toEqual([READ_LIST, toast('passkey-added')])
    expect(settings.actor.getSnapshot().context.passkeysError).toBeUndefined()
  })

  it.each(['data:PASSKEY_CANCELLED', 'data:AUTH_FAILED', 'data:OFFLINE'] as const)(
    'says why %s added nothing, reading nothing',
    async (code) => {
      const settings = screen({ addPasskey: () => errAsync(dataError(code, 'refused')) })

      settings.actor.send(ADD)

      const refused = await waitFor(settings.actor, (state) => state.context.passkeysError === code)

      expect(refused.matches(adding('idle'))).toBe(true)
      expect(settings.emitted).toEqual([])
      expect(refused.can(ADD)).toBe(true)
    },
  )

  it('forgets the last refusal once a passkey is added', async () => {
    let refuse = true
    const settings = screen({
      addPasskey: () =>
        refuse ? errAsync(dataError('data:PASSKEY_CANCELLED', 'closed')) : okAsync(undefined),
    })

    settings.actor.send(ADD)
    await waitFor(settings.actor, (state) => state.context.passkeysError !== undefined)

    refuse = false
    settings.actor.send(ADD)

    const added = await waitFor(
      settings.actor,
      (state) => state.context.passkeysError === undefined,
    )

    expect(added.matches(adding('idle'))).toBe(true)
  })
})

describe('the passkey remove region', () => {
  const id = passkeyIdFactory.create()

  it('removes the passkey it was pressed on, then reads the list and says so', async () => {
    const removePasskey = vi.fn((_passkey: PasskeyId) => okAsync(undefined))
    const settings = screen({ removePasskey })

    settings.actor.send(remove(id))

    expect(settings.actor.getSnapshot().can(remove(id))).toBe(false)

    await waitFor(settings.actor, (state) => state.matches(removing('idle')))

    expect(removePasskey).toHaveBeenCalledWith(id)
    expect(settings.emitted).toEqual([READ_LIST, toast('passkey-removed')])
  })

  it('says why it could not remove it and reads the list as it is now', async () => {
    const settings = screen({
      removePasskey: () => errAsync(dataError('data:WRITE_REJECTED', 'x')),
    })

    settings.actor.send(remove(id))

    const refused = await waitFor(
      settings.actor,
      (state) => state.context.passkeysError !== undefined,
    )

    expect(refused.matches(removing('idle'))).toBe(true)
    expect(refused.context.passkeysError).toBe('data:WRITE_REJECTED')
    expect(settings.emitted).toEqual([READ_LIST])
  })

  it('takes its turns apart from the adding', () => {
    const settings = screen({ addPasskey: () => new ResultAsync(new Promise(() => {})) })

    settings.actor.send(ADD)

    expect(settings.actor.getSnapshot().can(remove(id))).toBe(true)
  })
})
