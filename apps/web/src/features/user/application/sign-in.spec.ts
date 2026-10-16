import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type LocalDb, ShapeRunner } from '@workspace/data'

import { openTestSession } from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { ProfileService } from './profile.service'
import { createSignInMachine } from './sign-in.machine'
import { SignInService } from './sign-in.service'

const ann = { email: 'ann@example.test', password: 'secret-ann', name: 'Ann' }

let local: LocalDb
let session: SessionService
let profiles: ProfileService
let signIn: SignInService

beforeEach(async () => {
  const opened = await openTestSession()

  local = opened.local
  session = opened.session
  profiles = new ProfileService(new ShapeRunner(local), opened.commands, {
    shape: profileShape,
    commands: profileCommands,
  })
  signIn = new SignInService(session, profiles)
})

afterEach(async () => {
  await session.close()
  await local.close()
})

const start = () => createActor(createSignInMachine(signIn)).start()

const settled = (actor: ReturnType<typeof start>) =>
  waitFor(actor, (state) => state.matches('done') || state.matches('failed'))

describe('sign-in', () => {
  it('creates an account with its profile and signs the user in', async () => {
    const actor = start()

    actor.send({ type: 'TOGGLE_MODE' })
    actor.send({ type: 'SUBMIT', form: ann })

    expect((await settled(actor)).value).toBe('done')

    const me = session.current()

    expect(me?.email).toBe(ann.email)

    expect((await session.flush()).isOk()).toBe(true)

    const user = me?.id ?? expect.unreachable('signed in')

    expect((await profiles.read({ user }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: ann.email },
    ])
  })

  it('signs in to an existing account', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)
    expect((await session.signOut()).isOk()).toBe(true)

    const actor = start()

    actor.send({ type: 'SUBMIT', form: { ...ann, name: '' } })

    expect((await settled(actor)).value).toBe('done')
    expect(session.current()?.email).toBe(ann.email)
  })

  it('stays on the form with the reason when the password is wrong, then recovers', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)
    expect((await session.signOut()).isOk()).toBe(true)

    const actor = start()

    actor.send({ type: 'SUBMIT', form: { ...ann, password: 'wrong-password' } })

    const failed = await settled(actor)

    expect(failed.value).toBe('failed')
    expect(failed.context.error).toBe('data:INVALID_CREDENTIALS')
    expect(session.current()).toBeUndefined()

    actor.send({ type: 'SUBMIT', form: ann })

    expect((await waitFor(actor, (state) => state.matches('done'))).context.error).toBeUndefined()
  })

  it('refuses an empty name before creating the account', async () => {
    const result = await signIn.signUp({ ...ann, name: '  ' })

    expect(result._unsafeUnwrapErr().code).toBe('profile:NAME_REQUIRED')
    expect(session.current()).toBeUndefined()
    expect((await signIn.signIn(ann))._unsafeUnwrapErr().code).toBe('data:INVALID_CREDENTIALS')
  })

  it('switches between signing in and creating an account', () => {
    const actor = start()

    expect(actor.getSnapshot().context.mode).toBe('sign-in')

    actor.send({ type: 'TOGGLE_MODE' })

    expect(actor.getSnapshot().context.mode).toBe('sign-up')

    actor.send({ type: 'TOGGLE_MODE' })

    expect(actor.getSnapshot().context.mode).toBe('sign-in')
  })
})
