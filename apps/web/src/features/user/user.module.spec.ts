import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SHAPE_RUNNER } from '@workspace/data'
import { Container } from '@workspace/di'

import { openTestSession, type TestSession } from '../../composition/__fixtures__/session'
import type { SessionService } from '../../composition/session'
import { COMMANDS } from '../../platform/commands.port'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE } from './application/profile.service'
import { SIGN_IN_SERVICE } from './application/sign-in.service'
import { UserModule } from './user.module'

let opened: TestSession
let session: SessionService
let container: Container

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session

  const root = new Container()
    .singleton(SHAPE_RUNNER, () => opened.runner)
    .singleton(COMMANDS, () => opened.commands)
    .singleton(SESSION, () => session)

  container = root.child()

  for (const provider of UserModule.providers) {
    container.singleton(provider.provide, provider.useFactory)
  }
})

afterEach(async () => {
  await opened.close()
})

describe('UserModule', () => {
  it('provides sign-in and profile services over the application ports', async () => {
    const user = (
      await container
        .get(SIGN_IN_SERVICE)
        .signUp({ email: 'ann@example.test', password: 'secret-ann', name: 'Ann' })
    )._unsafeUnwrap()

    expect((await session.flush()).isOk()).toBe(true)

    expect(
      (await container.get(PROFILE_SERVICE).read({ identity: user.id }))._unsafeUnwrap(),
    ).toMatchObject([{ name: 'Ann' }])
  })

  it('routes guests to sign-in and signed-in users to their profile', () => {
    expect(UserModule.routes).toEqual([
      { path: '/sign-in', page: 'SignInPage', guard: 'guest' },
      { path: '/me', page: 'ProfilePage', guard: 'authenticated' },
    ])
    expect(Object.keys(UserModule.declarations).sort()).toEqual(['ProfilePage', 'SignInPage'])
  })
})
