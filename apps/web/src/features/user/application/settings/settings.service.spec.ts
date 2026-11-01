import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { type SettingsId, settingsIdFactory } from '@workspace/ids'

import {
  openTestSession,
  signUpVerified,
  type TestSession,
} from '../../../../composition/__fixtures__/session'
import type { SessionService } from '../../../../composition/session'

import { settingsCommands, settingsShape } from './settings.model.gen'
import { SettingsService } from './settings.service'

let opened: TestSession
let session: SessionService
let service: SettingsService
let me: AuthUser
let settingsId: SettingsId

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session
  service = new SettingsService(opened.runner, opened.commands, {
    shape: settingsShape,
    commands: settingsCommands,
  })
  me = (
    await signUpVerified(session, opened.auth, {
      email: 'ann@example.test',
      password: 'Secret-ann1',
      name: 'Ann',
      locale: 'en',
    })
  )._unsafeUnwrap()
  settingsId = settingsIdFactory.create()

  expect(
    (await service.createSettings({ id: settingsId, identity: me.id, locale: 'en' })).isOk(),
  ).toBe(true)
  expect((await session.flush()).isOk()).toBe(true)
})

afterEach(async () => {
  await opened.close()
})

describe('SettingsService', () => {
  it('reads the one row of settings of the signed-in account, in the language it started with', async () => {
    expect((await service.read({ identity: me.id }))._unsafeUnwrap()).toEqual([
      { id: settingsId, locale: 'en' },
    ])
  })

  it('stores the chosen language, and a watcher sees it', async () => {
    const seen: string[] = []
    const stop = service.watch({ identity: me.id }, (tree) => {
      seen.push(tree[0]?.locale ?? 'none')
    })

    expect((await service.updateLocale({ id: settingsId, locale: 'es' })).isOk()).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)

    await vi.waitFor(() => expect(seen.at(-1)).toBe('es'))
    expect((await service.read({ identity: me.id }))._unsafeUnwrap()[0]?.locale).toBe('es')

    stop()
  })
})
