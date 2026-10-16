import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type LocalDb, SHAPE_RUNNER, ShapeRunner } from '@workspace/data'
import { Container } from '@workspace/di'

import { openTestSession } from '../../composition/__fixtures__/session'
import type { SessionService } from '../../composition/session'
import { COMMANDS } from '../../platform/commands.port'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE } from './application/profile.service'
import { SIGN_IN_SERVICE } from './application/sign-in.service'
import { UserModule } from './user.module'

let local: LocalDb
let session: SessionService
let container: Container

beforeEach(async () => {
  const opened = await openTestSession()

  local = opened.local
  session = opened.session

  const root = new Container()
    .singleton(SHAPE_RUNNER, () => new ShapeRunner(local))
    .singleton(COMMANDS, () => opened.commands)
    .singleton(SESSION, () => session)

  container = root.child()

  for (const provider of UserModule.providers) {
    container.singleton(provider.provide, provider.useFactory)
  }
})

afterEach(async () => {
  await local.close()
})

describe('UserModule', () => {
  it('provides sign-in and profile services over the application ports', async () => {
    const user = (
      await container
        .get(SIGN_IN_SERVICE)
        .signUp({ email: 'ann@example.test', password: 'secret-ann', name: 'Ann' })
    )._unsafeUnwrap()

    await session.flush()

    expect(
      (await container.get(PROFILE_SERVICE).read({ user: user.id }))._unsafeUnwrap(),
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
