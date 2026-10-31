import { errAsync, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { dataError, type SignUpInput } from '@workspace/data'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { ProfileService } from './profile.service'
import { settingsCommands, settingsShape } from './settings/settings.model.gen'
import { SettingsService } from './settings/settings.service'
import { createSignInMachine } from './sign-in.machine'
import { SignInService } from './sign-in.service'

const ann = {
  email: 'ann@example.test',
  password: 'secret-ann',
  name: 'Ann',
  locale: 'es' as const,
}

let opened: TestSession
let session: SessionService
let profiles: ProfileService
let settings: SettingsService
let signIn: SignInService

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session
  profiles = new ProfileService(opened.runner, opened.commands, {
    shape: profileShape,
    commands: profileCommands,
  })
  settings = new SettingsService(opened.runner, opened.commands, {
    shape: settingsShape,
    commands: settingsCommands,
  })
  signIn = new SignInService(session, profiles, settings)
})

afterEach(async () => {
  await opened.close()
})

const start = () => createActor(createSignInMachine(signIn)).start()

/** The attempt has ended: the machine is done, or back in a mode with the failure's code. */
const settled = (actor: ReturnType<typeof start>) =>
  waitFor(actor, (state) => state.matches('done') || state.context.error !== undefined)

describe('sign-in', () => {
  it('creates an account with its profile and its settings, in the language of the form, and signs the user in', async () => {
    const actor = start()

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    expect((await settled(actor)).value).toBe('done')

    const me = session.current()

    expect(me?.email).toBe(ann.email)

    expect((await session.flush()).isOk()).toBe(true)

    const identity = me?.id ?? expect.unreachable('signed in')

    expect((await profiles.read({ identity }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: ann.email },
    ])
    expect((await settings.read({ identity }))._unsafeUnwrap()).toMatchObject([{ locale: 'es' }])
  })

  it('creates the settings before the profile, so a device holding the profile holds them too', async () => {
    const written: string[] = []
    const ordered = new SignInService(
      session,
      { createProfile: () => okAsync(written.push('profile')).map(() => undefined) },
      { createSettings: () => okAsync(written.push('settings')).map(() => undefined) },
    )

    expect((await ordered.signUp(ann)).isOk()).toBe(true)
    expect(written).toEqual(['settings', 'profile'])
  })

  it('makes the account with the name of the form, as its profile takes it', async () => {
    const asked: SignUpInput[] = []
    const naming = new SignInService(
      {
        signIn: (input) => session.signIn(input),
        signUp: (input) => {
          asked.push(input)

          return session.signUp(input)
        },
      },
      profiles,
      settings,
    )

    expect((await naming.signUp({ ...ann, name: '  Ann  ' })).isOk()).toBe(true)
    expect(asked).toEqual([{ email: ann.email, password: ann.password, name: 'Ann' }])
  })

  it('writes no profile when the settings could not be created', async () => {
    const written: string[] = []
    const refused = new SignInService(
      session,
      { createProfile: () => okAsync(written.push('profile')).map(() => undefined) },
      { createSettings: () => errAsync(dataError('data:WRITE_FAILED', 'not stored')) },
    )

    expect((await refused.signUp(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(written).toEqual([])
  })

  it('keeps the email in lower case in the account and its profile, however it was written', async () => {
    expect((await signIn.signUp({ ...ann, email: 'Ann@Example.Test' })).isOk()).toBe(true)
    expect(session.current()?.email).toBe('ann@example.test')
    expect((await session.flush()).isOk()).toBe(true)

    const identity = session.current()?.id ?? expect.unreachable('signed in')

    expect((await profiles.read({ identity }))._unsafeUnwrap()).toMatchObject([
      { email: 'ann@example.test' },
    ])
  })

  it('signs in to an existing account', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)
    expect((await session.signOut()).isOk()).toBe(true)

    const actor = start()

    actor.send({ type: 'user.sign-in.submit-button', form: { ...ann, name: '' } })

    expect((await settled(actor)).value).toBe('done')
    expect(session.current()?.email).toBe(ann.email)
  })

  it('stays on the form with the reason when the password is wrong, then recovers', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)
    expect((await session.signOut()).isOk()).toBe(true)

    const actor = start()

    actor.send({ type: 'user.sign-in.submit-button', form: { ...ann, password: 'wrong-password' } })

    const failed = await settled(actor)

    expect(failed.value).toBe('sign-in')
    expect(failed.context.error).toBe('data:INVALID_CREDENTIALS')
    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    expect((await waitFor(actor, (state) => state.matches('done'))).context.error).toBeUndefined()
  })

  it('refuses an empty name before creating the account', async () => {
    const result = await signIn.signUp({ ...ann, name: '  ' })

    expect(result._unsafeUnwrapErr().code).toBe('profile:NAME_REQUIRED')
    expect(session.current()).toBeUndefined()
    expect((await signIn.signIn(ann))._unsafeUnwrapErr().code).toBe('data:INVALID_CREDENTIALS')
  })

  it('asks its host to show the welcome, then to move to the profile', async () => {
    const actor = start()
    const asked: unknown[] = []

    actor.on('show', (event) => asked.push(event))
    actor.on('navigate', (event) => asked.push(event))
    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    expect((await settled(actor)).value).toBe('done')
    expect(asked).toEqual([
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: '/me' },
    ])
  })

  it('goes back to the mode it failed in, and a switch of mode clears the reason', async () => {
    const actor = start()

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: { ...ann, name: ' ' } })

    const failed = await settled(actor)

    expect(failed.value).toBe('sign-up')
    expect(failed.context.error).toBe('profile:NAME_REQUIRED')

    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })
  })

  it('switches between signing in and creating an account', () => {
    const actor = start()

    expect(actor.getSnapshot().value).toBe('sign-in')

    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot().value).toBe('sign-up')

    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot().value).toBe('sign-in')
  })
})
