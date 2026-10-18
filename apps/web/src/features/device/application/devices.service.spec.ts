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

beforeEach(() => {
  devices = new FakeDevices()
  service = new DevicesService(devices)
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

  it("signs every device out at the gateway and only awaits its answer: this device's session signs itself out", async () => {
    expect((await service.signOutEverywhere()).isOk()).toBe(true)
    expect(devices.calls).toEqual([['everywhere']])
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
