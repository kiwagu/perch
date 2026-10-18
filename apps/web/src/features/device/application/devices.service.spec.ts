import { okAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'

import {
  FakeDevices,
  laptop,
  offline,
  phone,
  REVOKED_AT,
} from '../../../platform/__fixtures__/devices'

import { DevicesService } from './devices.service'

let devices: FakeDevices
let service: DevicesService
/** How many times the service had the session sign this device out. */
let signedOut: number
/** How many gateway calls had gone when the service named the session that asks, if it did. */
let namedAfter: number | undefined

beforeEach(() => {
  devices = new FakeDevices()
  signedOut = 0
  namedAfter = undefined
  service = new DevicesService(devices, {
    signingOutEverywhere: () => {
      namedAfter = devices.calls.length

      return () => {
        signedOut += 1

        return okAsync(undefined)
      }
    },
  })
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

  it('signs every device out at the gateway, then this one through its session, sync channel or not', async () => {
    expect((await service.signOutEverywhere()).isOk()).toBe(true)
    expect(devices.calls).toEqual([['everywhere']])
    expect(signedOut).toBe(1)
  })

  it('names the session that asks before the request goes, so a late answer finds which one to sign out', async () => {
    expect((await service.signOutEverywhere()).isOk()).toBe(true)
    expect(namedAfter).toBe(0)
  })

  it('fails as the gateway failed, and reads nothing after a refused sign-out', async () => {
    devices.refusal = dataError('data:WRITE_REJECTED', 'no-such-device')

    expect((await service.revoke(phone))._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(devices.calls).toEqual([['revoke', phone.id]])

    devices.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.signOutEverywhere())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
    // The gateway signed nobody out: this device stays signed in.
    expect(signedOut).toBe(0)

    devices.refusal = dataError('data:OFFLINE', 'could not reach the gateway')

    expect((await service.list())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })
})
