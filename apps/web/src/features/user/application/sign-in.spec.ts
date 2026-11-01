import { errAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type DataError, dataError, type SignUpInput } from '@workspace/data'

import {
  openTestSession,
  signUpVerified,
  type TestSession,
} from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import type { SessionPort } from '../../../platform/session.port'
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
let signIn: SignInService

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session
  signIn = new SignInService(session)
})

afterEach(async () => {
  await opened.close()
})

/** What the sign-in service asks of the session, each call recorded. */
type Asked =
  | { readonly signUp: SignUpInput }
  | { readonly signIn: string }
  | { readonly resend: string }

/** A session whose answers the test sets, recording what is asked of it. */
function recordingSession(
  answers: { readonly resend?: () => ReturnType<SessionPort['resendVerification']> } = {},
) {
  const asked: Asked[] = []
  const port: Pick<SessionPort, 'signIn' | 'signUp' | 'resendVerification'> = {
    signUp: (input) => {
      asked.push({ signUp: input })

      return session.signUp(input)
    },
    signIn: (input) => {
      asked.push({ signIn: input.email })

      return session.signIn(input)
    },
    resendVerification: (email) => {
      asked.push({ resend: email })

      return answers.resend ? answers.resend() : session.resendVerification(email)
    },
  }

  return { asked, port }
}

const start = (service: SignInService = signIn) => createActor(createSignInMachine(service)).start()

/** The attempt has ended: the machine is done, asks to check the mail, or shows a failure. */
const settled = (actor: ReturnType<typeof start>) =>
  waitFor(
    actor,
    (state) =>
      state.matches('done') || state.matches('check-mail') || state.context.error !== undefined,
  )

/** Ann's account, verified on this device and signed out again: it signs in. */
async function annVerified(): Promise<void> {
  expect((await signUpVerified(session, opened.auth, ann)).isOk()).toBe(true)
  expect((await session.signOut()).isOk()).toBe(true)
}

describe('the sign-in service', () => {
  it('signs the account up with the name and the language of the form, and writes nothing', async () => {
    const { asked, port } = recordingSession()
    const naming = new SignInService(port)

    expect((await naming.signUp({ ...ann, name: '  Ann  ' }))._unsafeUnwrap()).toBeUndefined()
    expect(asked).toEqual([
      { signUp: { email: ann.email, password: ann.password, name: 'Ann', locale: 'es' } },
    ])
    // Nothing is signed in, and the account's settings and profile wait for its link.
    expect(session.current()).toBeUndefined()

    const verified = (await session.verifyEmail(opened.auth.linkFor(ann.email)))._unsafeUnwrap()
    const identity = verified.kind === 'signed-in' ? verified.user.id : expect.unreachable('in')
    const profiles = new ProfileService(opened.runner, opened.commands, {
      shape: profileShape,
      commands: profileCommands,
    })
    const settings = new SettingsService(opened.runner, opened.commands, {
      shape: settingsShape,
      commands: settingsCommands,
    })

    expect((await session.flush()).isOk()).toBe(true)
    expect((await profiles.read({ identity }))._unsafeUnwrap()).toEqual([])
    expect((await settings.read({ identity }))._unsafeUnwrap()).toEqual([])
  })

  it.each([
    ['  ', 'profile:NAME_REQUIRED'],
    ['a'.repeat(81), 'profile:NAME_TOO_LONG'],
  ])('refuses the name %j before it asks anything', async (name, code) => {
    const { asked, port } = recordingSession()

    expect((await new SignInService(port).signUp({ ...ann, name }))._unsafeUnwrapErr().code).toBe(
      code,
    )
    expect(asked).toEqual([])
  })

  it('has the verification mail sent again, once, to the email it is given', async () => {
    const { asked, port } = recordingSession()

    expect((await new SignInService(port).resend(ann.email)).isOk()).toBe(true)
    expect(asked).toEqual([{ resend: ann.email }])
  })
})

describe('the sign-in form', () => {
  it('asks to check the mail after a sign-up, in the mode sign-in, signing nothing in and asking its host nothing', async () => {
    const actor = start()
    const emitted: unknown[] = []

    actor.on('*', (event) => emitted.push(event))
    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    const asked = await settled(actor)

    expect(asked.value).toBe('check-mail')
    // The address the mail went to stays with the message, whatever the field holds later.
    expect(asked.context).toStrictEqual({
      error: undefined,
      mail: 'check-your-mail',
      sentTo: ann.email,
    })
    expect(emitted).toEqual([])
    expect(session.current()).toBeUndefined()
  })

  it('signs in to an account whose email is verified, then asks its host to show the welcome and move to the profile', async () => {
    await annVerified()

    const actor = start()
    const asked: unknown[] = []

    actor.on('show', (event) => asked.push(event))
    actor.on('navigate', (event) => asked.push(event))
    actor.send({ type: 'user.sign-in.submit-button', form: { ...ann, name: '' } })

    expect((await settled(actor)).value).toBe('done')
    expect(session.current()?.email).toBe(ann.email)
    expect(asked).toEqual([
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: '/me' },
    ])
  })

  it('says the email is not verified yet when an account signs in before its link is opened', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)

    const actor = start()

    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    const refused = await settled(actor)

    expect(refused.value).toBe('unverified')
    expect(refused.context).toStrictEqual({
      error: 'data:EMAIL_NOT_VERIFIED',
      mail: undefined,
      sentTo: undefined,
    })
    expect(session.current()).toBeUndefined()
  })

  it.each(['check-mail', 'unverified'] as const)(
    'resends the mail from %s to the email of the event, then shows the mail message alone',
    async (from) => {
      const actor = start()

      actor.send({ type: 'user.sign-in.toggle-button' })
      actor.send({ type: 'user.sign-in.submit-button', form: ann })
      await settled(actor)

      if (from === 'unverified') {
        actor.send({ type: 'user.sign-in.submit-button', form: ann })
        await waitFor(actor, (state) => state.matches('unverified'))
      }

      opened.auth.requests.splice(0)
      actor.send({ type: 'user.sign-in.resend-button', email: 'Ann@Example.Test' })

      expect(actor.getSnapshot().value).toBe('resending')

      const resent = await waitFor(actor, (state) => state.matches('check-mail'))

      expect(resent.context).toStrictEqual({
        error: undefined,
        mail: 'check-your-mail',
        sentTo: 'Ann@Example.Test',
      })
      expect(opened.auth.requests).toEqual([{ kind: 'resend', email: 'Ann@Example.Test' }])
    },
  )

  it('goes to unverified with the reason when the resend fails, and the mail message goes', async () => {
    const limited = (): ReturnType<SessionPort['resendVerification']> =>
      errAsync<void, DataError>(dataError('data:RATE_LIMITED', 'too many attempts'))
    const { port } = recordingSession({ resend: limited })
    const actor = start(new SignInService(port))

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })
    expect((await settled(actor)).context.mail).toBe('check-your-mail')

    actor.send({ type: 'user.sign-in.resend-button', email: ann.email })

    const failed = await waitFor(actor, (state) => state.matches('unverified'))

    expect(failed.context).toStrictEqual({
      error: 'data:RATE_LIMITED',
      mail: undefined,
      sentTo: undefined,
    })
  })

  it('lets the mail message go when a sign-in starts from it', async () => {
    const actor = start()

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })
    await settled(actor)

    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    expect(actor.getSnapshot()).toMatchObject({
      value: 'signing-in',
      context: { error: undefined, mail: undefined, sentTo: undefined },
    })
  })

  it('lets the mail message go when the form switches to sign-up from it', async () => {
    const actor = start()

    actor.send({ type: 'user.sign-in.toggle-button' })
    actor.send({ type: 'user.sign-in.submit-button', form: ann })
    await settled(actor)

    actor.send({ type: 'user.sign-in.toggle-button' })

    expect(actor.getSnapshot()).toMatchObject({
      value: 'sign-up',
      context: { error: undefined, mail: undefined, sentTo: undefined },
    })
  })

  it('stays on the form with the reason when the password is wrong, then recovers', async () => {
    await annVerified()

    const actor = start()

    actor.send({ type: 'user.sign-in.submit-button', form: { ...ann, password: 'wrong-password' } })

    const failed = await settled(actor)

    expect(failed.value).toBe('sign-in')
    expect(failed.context.error).toBe('data:INVALID_CREDENTIALS')
    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.submit-button', form: ann })

    expect((await waitFor(actor, (state) => state.matches('done'))).context.error).toBeUndefined()
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
