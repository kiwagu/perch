import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type DataError, dataError } from '@workspace/data'
import { device_sessionIdFactory } from '@workspace/ids'

import { createDevicesMachine } from './devices.machine'

const phone = device_sessionIdFactory.create()

const refused = (): ResultAsync<never, DataError> => errAsync(dataError('data:OFFLINE', 'offline'))

/** A devices page: its writes, the machine over them, and what the machine emitted. */
function page(
  writes: {
    readonly revoke?: () => ResultAsync<unknown, DataError>
    readonly signOutEverywhere?: () => ResultAsync<unknown, DataError>
  } = {},
) {
  const revoke = vi.fn(writes.revoke ?? (() => okAsync(undefined)))
  const signOutEverywhere = vi.fn(writes.signOutEverywhere ?? (() => okAsync(undefined)))
  const actor = createActor(createDevicesMachine({ revoke, signOutEverywhere })).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, revoke, signOutEverywhere, emitted, snapshot: () => actor.getSnapshot() }
}

const FAILED = {
  type: 'show',
  anchor: 'app-shell.notice-message',
  codes: ['device-sign-out-failed'],
}

/** The read of the devices the flow asks for after a sign-out. */
const READ = { type: 'read', anchor: 'device.list' }

describe('devices machine', () => {
  it('signs another device out with its toast, holding the sign-out buttons while it runs', async () => {
    const { actor, revoke, snapshot, emitted } = page()

    actor.send({ type: 'device.list.revoke-button', device: phone })

    expect(snapshot().can({ type: 'device.list.revoke-button', device: phone })).toBe(false)
    expect(snapshot().can({ type: 'device.everywhere.open-button' })).toBe(false)

    await waitFor(actor, (state) => state.matches('viewing'))

    expect(revoke).toHaveBeenCalledWith(phone)
    expect(emitted).toEqual([
      READ,
      { type: 'show', anchor: 'app-shell.toast', codes: ['device-signed-out'] },
    ])
  })

  it('says so on the shell when the gateway refuses a sign-out, and reads the devices again', async () => {
    const { actor, emitted } = page({
      revoke: () => errAsync(dataError('data:WRITE_REJECTED', 'device-sign-out-failed')),
    })

    actor.send({ type: 'device.list.revoke-button', device: phone })
    await waitFor(actor, (state) => state.matches('viewing'))

    expect(emitted).toEqual([FAILED, READ])
  })

  it('says so on the shell when the gateway is out of reach, and reads nothing: that read would fail too', async () => {
    const { actor, emitted } = page({ revoke: refused })

    actor.send({ type: 'device.list.revoke-button', device: phone })
    await waitFor(actor, (state) => state.matches('viewing'))

    expect(emitted).toEqual([FAILED])
  })

  it('asks before signing every device out, and stays when the dialog is cancelled', () => {
    const { actor, snapshot, emitted, signOutEverywhere } = page()

    actor.send({ type: 'device.everywhere.open-button' })

    expect(snapshot().matches('confirming')).toBe(true)
    expect(emitted).toEqual([
      { type: 'show', anchor: 'device.everywhere.dialog', codes: ['sign-out-everywhere'] },
    ])

    actor.send({ type: 'device.everywhere.dialog.cancel-button' })

    expect(snapshot().matches('viewing')).toBe(true)
    expect(signOutEverywhere).not.toHaveBeenCalled()
  })

  it('signs every device out once confirmed, and moves to sign-in', async () => {
    const { actor, emitted, signOutEverywhere } = page()

    actor.send({ type: 'device.everywhere.open-button' })
    actor.send({ type: 'device.everywhere.dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('signed-out'))

    expect(signOutEverywhere).toHaveBeenCalledOnce()
    expect(emitted.slice(1)).toEqual([
      { type: 'show', anchor: 'user.sign-in.notice-message', codes: ['signed-out-elsewhere'] },
      { type: 'navigate', to: '/sign-in' },
    ])
  })

  it('says so on the shell when signing every device out fails, and lets it be asked again', async () => {
    const { actor, snapshot, emitted } = page({ signOutEverywhere: refused })

    actor.send({ type: 'device.everywhere.open-button' })
    actor.send({ type: 'device.everywhere.dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('viewing'))

    expect(emitted.slice(1)).toEqual([FAILED])
    expect(snapshot().can({ type: 'device.everywhere.open-button' })).toBe(true)
  })
})
