import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { Container } from '@workspace/di'

import { fakeSession } from '../../platform/__fixtures__/session'
import { DEVICES, type DevicesPort } from '../../platform/devices.port'
import { SESSION } from '../../platform/session.port'

import { DEVICES_SERVICE } from './application/devices.service'
import { DeviceModule } from './device.module'

const none: DevicesPort = {
  list: () => okAsync([]),
  revoke: () => okAsync(undefined),
  signOutEverywhere: () => okAsync(undefined),
}

describe('DeviceModule', () => {
  it('provides the devices service over the devices port and the session', async () => {
    const root = new Container()
      .singleton(DEVICES, () => none)
      .singleton(SESSION, () => fakeSession().session)
    const container = root.child()

    for (const provider of DeviceModule.providers) {
      container.singleton(provider.provide, provider.useFactory)
    }

    expect((await container.get(DEVICES_SERVICE).list())._unsafeUnwrap()).toEqual([])
  })

  it('routes signed-in users to the devices page', () => {
    expect(DeviceModule.routes).toEqual([
      { path: '/devices', page: 'DevicesPage', guard: 'authenticated' },
    ])
    expect(Object.keys(DeviceModule.declarations)).toEqual(['DevicesPage'])
  })
})
