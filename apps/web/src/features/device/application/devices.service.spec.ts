import { okAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'

import {
  FakeDevices,
  laptop,
  offline,
  phone,
  REVOKED_AT,
} from '../../../platform/__fixtures__/devices'
import type { SignOutOptions } from '../../../platform/session.port'

import { DevicesService, type DevicesSession } from './devices.service'

/** The session's sign-out: it answers `outcome` and keeps what it was asked. */
class FakeSession implements DevicesSession {
  readonly signOuts: Array<SignOutOptions | undefined> = []
  outcome: 'signed-out' | 'needs-confirmation' = 'signed-out'

  signOut(options?: SignOutOptions) {
    this.signOuts.push(options)

    return okAsync<'signed-out' | 'needs-confirmation', DataError>(this.outcome)
  }
}

let devices: FakeDevices
let session: FakeSession
let service: DevicesService

beforeEach(() => {
  devices = new FakeDevices()
  session = new FakeSession()
  service = new DevicesService(devices, session)
})

describe('DevicesService', () => {
  it("lists the identity's devices", async () => {
    expect((await service.list())._unsafeUnwrap()).toEqual([laptop, phone])
  })

  it('signs another device out at the gateway, then reads the list again', async () => {
    const outcome = (await service.revoke(phone))._unsafeUnwrap()

    expect(devices.calls).toEqual([['revoke', phone.id], ['list']])
    expect(outcome).toEqual({
      kind: 'listed',
      devices: [laptop, { ...phone, revokedAt: REVOKED_AT }],
    })
    expect(session.signOuts).toEqual([])
  })

  it('counts a sign-out of another device as done when the list cannot be read again', async () => {
    const list = devices.list.bind(devices)

    devices.list = () => {
      devices.list = list
      devices.refusal = offline()

      return list()
    }

    // The first read is the one after the sign-out: the sign-out itself went through.
    expect((await service.revoke(phone))._unsafeUnwrap()).toEqual({ kind: 'revoked' })
    expect(devices.calls).toEqual([['revoke', phone.id], ['list']])
  })

  it("signs this device out through the session's sign-out, not through the device route", async () => {
    expect((await service.revoke(laptop))._unsafeUnwrap()).toEqual({ kind: 'signed-out' })
    expect(session.signOuts).toEqual([undefined])
    expect(devices.calls).toEqual([])
  })

  it('passes on a sign-out of this device that needs a confirmation', async () => {
    session.outcome = 'needs-confirmation'

    expect((await service.revoke(laptop))._unsafeUnwrap()).toEqual({ kind: 'needs-confirmation' })
  })

  it("signs every device out at the gateway and only awaits its answer: this device's session signs itself out", async () => {
    expect((await service.signOutEverywhere()).isOk()).toBe(true)
    expect(devices.calls).toEqual([['everywhere']])
    expect(session.signOuts).toEqual([])
  })

  it('fails as the gateway failed, and reads nothing after a refused sign-out', async () => {
    devices.refusal = dataError('data:WRITE_REJECTED', 'no-such-device')

    expect((await service.revoke(phone))._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(devices.calls).toEqual([['revoke', phone.id]])

    devices.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.signOutEverywhere())._unsafeUnwrapErr().code).toBe('data:OFFLINE')

    devices.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.list())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })
})
