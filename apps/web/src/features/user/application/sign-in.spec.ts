import { errAsync, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type CodeStep, type DataError, dataError, type SignUpInput } from '@workspace/data'
import { CONTRACT_ROUTES, CONTRACT_VALUES } from '@workspace/kernel'

import { assertionOf, fakeCeremony } from '../../../composition/__fixtures__/passkey-ceremony'
import {
  openTestSession,
  signUpVerified,
  type TestSession,
} from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import type { SessionPort, SignInResult } from '../../../platform/session.port'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { ProfileService } from './profile.service'
import { settingsCommands, settingsShape } from './settings/settings.model.gen'
import { SettingsService } from './settings/settings.service'
import { type SignInForm, SignInService } from './sign-in.service'
import { createSignInMachine } from './sign-in-machine'

const ann = {
  email: 'ann@example.test',
  password: 'Secret-ann1',
  name: 'Ann',
  locale: 'es' as const,
}

let opened: TestSession
let session: SessionService
let signIn: SignInService
/** The account whose passkey the browser's window picks, once a test sets one. */
let picked: string | undefined

beforeEach(async () => {
  picked = undefined
  opened = await openTestSession(undefined, {
    ceremony: fakeCeremony(() =>
      picked === undefined
        ? errAsync(dataError('data:PASSKEY_CANCELLED', 'the window was closed'))
        : okAsync(assertionOf(opened.auth.passkeyOf(picked))),
    ),
  })
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
  | { readonly confirm: { readonly step: CodeStep; readonly code: string; readonly out: boolean } }
  | { readonly passkey: string | undefined }
  | { readonly resend: string }

/** What the sign-in service asks of the session. */
type SignInSession = ConstructorParameters<typeof SignInService>[0]

/** A session whose answers the test sets, recording what is asked of it. */
function recordingSession(
  answers: { readonly resend?: () => ReturnType<SessionPort['resendVerification']> } = {},
) {
  const asked: Asked[] = []
  const port: SignInSession = {
    signUp: (input) => {
      asked.push({ signUp: input })

      return session.signUp(input)
    },
    signIn: (input) => {
      asked.push({ signIn: input.email })

      return session.signIn(input)
    },
    confirmSignIn: (step, code, out) => {
      asked.push({ confirm: { step, code, out } })

      return session.confirmSignIn(step, code, out)
    },
    signInWithPasskey: (signOutOldestFor) => {
      asked.push({ passkey: signOutOldestFor })

      return session.signInWithPasskey(signOutOldestFor)
    },
    resendVerification: (email) => {
      asked.push({ resend: email })

      return answers.resend ? answers.resend() : session.resendVerification(email)
    },
  }

  return { asked, port }
}

/** What the form keeps of a second step while none is under way. */
const NO_SECOND_STEP = {
  step: undefined,
  codeError: undefined,
  consentFor: undefined,
  attempt: undefined,
}

/** The switch of mode, Ann's password typed and typed again. */
const toggled = {
  type: 'user.sign-in.toggle-button' as const,
  password: ann.password,
  confirmation: ann.password,
}

/** The submit of `form`, the password typed again the same. */
const submitted = (form: SignInForm) => ({
  type: 'user.sign-in.submit-button' as const,
  form,
  confirmation: form.password,
})

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
    ['a'.repeat(CONTRACT_VALUES['profile.name'].maxLength + 1), 'profile:NAME_TOO_LONG'],
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

describe('a sign-in past the limit of devices', () => {
  it('asks before signing in, signing nothing in, and signs in once confirmed', async () => {
    await annVerified()
    opened.auth.atDeviceLimit(ann.email)

    const actor = start()

    actor.send(submitted(ann))
    await waitFor(actor, (state) => state.matches('device-limit'))

    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.device-limit-dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
    expect(
      opened.auth.requests.flatMap((request) =>
        request.kind === 'sign-in' ? [request.signOutOldest ?? false] : [],
      ),
    ).toEqual([false, true])
  })

  it('signs nothing in once the question is cancelled', async () => {
    await annVerified()
    opened.auth.atDeviceLimit(ann.email)

    const actor = start()

    actor.send(submitted(ann))
    await waitFor(actor, (state) => state.matches('device-limit'))
    actor.send({ type: 'user.sign-in.device-limit-dialog.cancel-button' })

    expect(actor.getSnapshot().value).toBe('sign-in')
    expect(session.current()).toBeUndefined()
  })
})

/** Ann's account, verified and signed out, whose second factor is on and takes `CODE`. */
const CODE = '123456'

async function annWithSecondFactor(): Promise<void> {
  await annVerified()
  opened.auth.secondFactor(ann.email, CODE)
}

/** The code step the password step of Ann's account asked for. */
async function annsStep(): Promise<CodeStep> {
  const outcome = (await signIn.signIn(ann, false))._unsafeUnwrap()

  return outcome.kind === 'code-required' ? outcome : expect.unreachable('a code was asked')
}

describe('a sign-in whose account asks for a code', () => {
  it('answers the code step the account asks, with the challenge and the email typed, signing nothing in', async () => {
    await annWithSecondFactor()

    const outcome = (await signIn.signIn(ann, false))._unsafeUnwrap()

    expect(outcome).toMatchObject({ kind: 'code-required', email: ann.email })
    expect(session.current()).toBeUndefined()
  })

  it('asks the session to take the code at the step, past the limit of devices or not', async () => {
    const { asked, port } = recordingSession()
    const step: CodeStep = { challenge: 'challenge-1', email: ann.email }
    const stepping = new SignInService(port)

    // The gateway knows no such challenge: each is refused, and each is asked as given.
    expect((await stepping.confirmSignIn(step, CODE, false)).isErr()).toBe(true)
    expect((await stepping.confirmSignIn(step, CODE, true)).isErr()).toBe(true)

    expect(asked).toEqual([
      { confirm: { step, code: CODE, out: false } },
      { confirm: { step, code: CODE, out: true } },
    ])
  })

  it.each([
    ['nothing', ''],
    ['five digits', '12345'],
    ['more than a backup code has', '0123456789ab'],
  ])('asks the session nothing for %s, failing as no code', async (_, code) => {
    const { asked, port } = recordingSession()
    const step: CodeStep = { challenge: 'challenge-1', email: ann.email }

    expect(
      (await new SignInService(port).confirmSignIn(step, code, false))._unsafeUnwrapErr().code,
    ).toBe('sign-in:CODE_INVALID')
    expect(asked).toEqual([])
  })

  it.each(['123456', '0123456789a'])('leaves the code %s to the gateway', async (code) => {
    const { asked, port } = recordingSession()
    const step: CodeStep = { challenge: 'challenge-1', email: ann.email }

    expect((await new SignInService(port).confirmSignIn(step, code, false)).isErr()).toBe(true)
    expect(asked).toEqual([{ confirm: { step, code, out: false } }])
  })

  it('signs the device in once the code is right, and fails a wrong one as data:INVALID_CODE', async () => {
    await annWithSecondFactor()

    const step = await annsStep()

    expect((await signIn.confirmSignIn(step, '000000', false))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CODE',
    )
    expect(session.current()).toBeUndefined()

    const done = (await signIn.confirmSignIn(step, CODE, false))._unsafeUnwrap()

    expect(done.kind === 'signed-in' ? done.user.email : undefined).toBe(ann.email)
    expect(session.current()?.email).toBe(ann.email)
  })

  it('answers the limit of devices as the outcome the form asks about', async () => {
    const limited: SignInSession = {
      ...recordingSession().port,
      signIn: () => okAsync<SignInResult, DataError>({ kind: 'device-limit' }),
    }

    expect((await new SignInService(limited).signIn(ann, false))._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
    })
  })

  it('asks the code, takes it and says the welcome in the form, signing the account in', async () => {
    await annWithSecondFactor()

    const actor = start()
    const emitted: unknown[] = []

    actor.on('show', (event) => emitted.push(event))
    actor.on('navigate', (event) => emitted.push(event))
    actor.send(submitted(ann))
    await waitFor(actor, (state) => state.matches('code'))

    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.code.dialog.confirm-button', code: CODE })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
    expect(emitted).toEqual([
      { type: 'show', anchor: 'user.sign-in.code.dialog', codes: ['code-required'] },
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: CONTRACT_ROUTES['user.profile'] },
    ])
  })

  it('asks again under the field after a wrong code, and signs in with the right one', async () => {
    await annWithSecondFactor()

    const actor = start()

    actor.send(submitted(ann))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send({ type: 'user.sign-in.code.dialog.confirm-button', code: '000000' })

    const refused = await waitFor(actor, (state) => state.context.codeError !== undefined)

    expect(refused.value).toBe('code')
    expect(refused.context.codeError).toBe('data:INVALID_CODE')
    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.code.dialog.confirm-button', code: CODE })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
  })

  it('signs in all the same past the limit of devices: the password again, then the code again', async () => {
    await annWithSecondFactor()
    opened.auth.atDeviceLimit(ann.email)
    opened.auth.requests.splice(0)

    const actor = start()

    actor.send(submitted(ann))
    await waitFor(actor, (state) => state.matches('code'))
    actor.send({ type: 'user.sign-in.code.dialog.confirm-button', code: CODE })
    await waitFor(actor, (state) => state.matches('device-limit'))

    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.device-limit-dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('code-anyway'))
    actor.send({ type: 'user.sign-in.code.dialog.confirm-button', code: CODE })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
    expect(opened.auth.requests.map((request) => request.kind)).toEqual([
      'sign-in',
      'confirm-sign-in',
      'sign-in',
      'confirm-sign-in',
    ])
  })
})

describe('a sign-in with a passkey', () => {
  it('asks the session for the passkey, naming the account only when a confirmation names one', async () => {
    const { asked, port } = recordingSession()
    const keyed = new SignInService(port)

    // The browser's window is closed, so each is refused, and each is asked as given.
    expect((await keyed.signInWithPasskey()).isErr()).toBe(true)
    expect((await keyed.signInWithPasskey('idn_ann')).isErr()).toBe(true)

    expect(asked).toEqual([{ passkey: undefined }, { passkey: 'idn_ann' }])
  })

  it('signs the device in with the passkey the browser picks, asking no password and no code', async () => {
    await annWithSecondFactor()
    picked = ann.email
    opened.auth.requests.splice(0)

    const actor = start()

    actor.send({ type: 'user.sign-in.passkey-button' })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
    expect(opened.auth.requests.map((request) => request.kind)).toEqual([
      'passkey-options',
      'passkey-sign-in',
    ])
  })

  it('goes back to the form saying no passkey was used, signing nothing in', async () => {
    await annVerified()

    const actor = start()

    actor.send({ type: 'user.sign-in.passkey-button' })

    const closed = await waitFor(actor, (state) => state.context.error !== undefined)

    expect(closed.value).toBe('sign-in')
    expect(closed.context.error).toBe('data:PASSKEY_CANCELLED')
    expect(session.current()).toBeUndefined()
  })

  it('says no account holds a passkey it does not know', async () => {
    await annVerified()
    picked = 'nobody@example.test'

    const actor = start()

    actor.send({ type: 'user.sign-in.passkey-button' })

    const unknown = await waitFor(actor, (state) => state.context.error !== undefined)

    expect(unknown.value).toBe('sign-in')
    expect(unknown.context.error).toBe('data:PASSKEY_UNKNOWN')
  })

  it('asks about the limit of devices naming the account, then signs in naming it once confirmed', async () => {
    await annVerified()
    opened.auth.atDeviceLimit(ann.email)
    picked = ann.email

    const actor = start()

    actor.send({ type: 'user.sign-in.passkey-button' })
    await waitFor(actor, (state) => state.matches('passkey-device-limit'))

    expect(actor.getSnapshot().context.consentFor).toBe(opened.auth.identityOf(ann.email).id)
    expect(session.current()).toBeUndefined()

    actor.send({ type: 'user.sign-in.device-limit-dialog.confirm-button' })
    await waitFor(actor, (state) => state.matches('done'))

    expect(session.current()?.email).toBe(ann.email)
  })
})

describe('the sign-in form', () => {
  it('asks to check the mail after a sign-up, in the mode sign-in, signing nothing in and asking its host nothing', async () => {
    const actor = start()
    const emitted: unknown[] = []

    actor.on('*', (event) => emitted.push(event))
    actor.send(toggled)
    actor.send(submitted(ann))

    const asked = await settled(actor)

    expect(asked.value).toBe('check-mail')
    // The address the mail went to stays with the message, whatever the field holds later.
    expect(asked.context).toStrictEqual({
      error: undefined,
      mail: 'check-your-mail',
      sentTo: ann.email,
      ...NO_SECOND_STEP,
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
    actor.send(submitted({ ...ann, name: '' }))

    expect((await settled(actor)).value).toBe('done')
    expect(session.current()?.email).toBe(ann.email)
    expect(asked).toEqual([
      { type: 'show', anchor: 'app-shell.notice-message', codes: ['welcome'] },
      { type: 'navigate', to: CONTRACT_ROUTES['user.profile'] },
    ])
  })

  it('says the email is not verified yet when an account signs in before its link is opened', async () => {
    expect((await signIn.signUp(ann)).isOk()).toBe(true)

    const actor = start()

    actor.send(submitted(ann))

    const refused = await settled(actor)

    expect(refused.value).toBe('unverified')
    expect(refused.context).toStrictEqual({
      error: 'data:EMAIL_NOT_VERIFIED',
      mail: undefined,
      sentTo: undefined,
      ...NO_SECOND_STEP,
    })
    expect(session.current()).toBeUndefined()
  })

  it.each(['check-mail', 'unverified'] as const)(
    'resends the mail from %s to the email of the event, then shows the mail message alone',
    async (from) => {
      const actor = start()

      actor.send(toggled)
      actor.send(submitted(ann))
      await settled(actor)

      if (from === 'unverified') {
        actor.send(submitted(ann))
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
        ...NO_SECOND_STEP,
      })
      expect(opened.auth.requests).toEqual([{ kind: 'resend', email: 'Ann@Example.Test' }])
    },
  )

  it('goes to unverified with the reason when the resend fails, and the mail message goes', async () => {
    const limited = (): ReturnType<SessionPort['resendVerification']> =>
      errAsync<void, DataError>(dataError('data:RATE_LIMITED', 'too many attempts'))
    const { port } = recordingSession({ resend: limited })
    const actor = start(new SignInService(port))

    actor.send(toggled)
    actor.send(submitted(ann))
    expect((await settled(actor)).context.mail).toBe('check-your-mail')

    actor.send({ type: 'user.sign-in.resend-button', email: ann.email })

    const failed = await waitFor(actor, (state) => state.matches('unverified'))

    expect(failed.context).toStrictEqual({
      error: 'data:RATE_LIMITED',
      mail: undefined,
      sentTo: undefined,
      ...NO_SECOND_STEP,
    })
  })

  it('lets the mail message go when a sign-in starts from it', async () => {
    const actor = start()

    actor.send(toggled)
    actor.send(submitted(ann))
    await settled(actor)

    actor.send(submitted(ann))

    expect(actor.getSnapshot()).toMatchObject({
      value: 'signing-in',
      context: { error: undefined, mail: undefined, sentTo: undefined },
    })
  })

  it('lets the mail message go when the form switches to sign-up from it', async () => {
    const actor = start()

    actor.send(toggled)
    actor.send(submitted(ann))
    await settled(actor)

    actor.send(toggled)

    expect(actor.getSnapshot()).toMatchObject({
      value: 'sign-up',
      context: { error: undefined, mail: undefined, sentTo: undefined },
    })
  })

  it('stays on the form with the reason when the password is wrong, then recovers', async () => {
    await annVerified()

    const actor = start()

    actor.send(submitted({ ...ann, password: 'wrong-password' }))

    const failed = await settled(actor)

    expect(failed.value).toBe('sign-in')
    expect(failed.context.error).toBe('data:INVALID_CREDENTIALS')
    expect(session.current()).toBeUndefined()

    actor.send(submitted(ann))

    expect((await waitFor(actor, (state) => state.matches('done'))).context.error).toBeUndefined()
  })

  it('goes back to the mode it failed in, and a switch of mode clears the reason', async () => {
    const actor = start()

    actor.send(toggled)
    actor.send(submitted({ ...ann, name: ' ' }))

    const failed = await settled(actor)

    expect(failed.value).toBe('sign-up')
    expect(failed.context.error).toBe('profile:NAME_REQUIRED')

    actor.send(toggled)

    expect(actor.getSnapshot()).toMatchObject({ value: 'sign-in', context: { error: undefined } })
  })

  it('switches between signing in and creating an account', () => {
    const actor = start()

    expect(actor.getSnapshot().value).toBe('sign-in')

    actor.send(toggled)

    expect(actor.getSnapshot().value).toBe('sign-up')

    actor.send(toggled)

    expect(actor.getSnapshot().value).toBe('sign-in')
  })
})
