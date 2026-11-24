import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import {
  openTestSession,
  signUpVerified,
  type TestSession,
} from '../../../composition/__fixtures__/session'

import { type SignInForm, SignInService } from './sign-in.service'
import { createSignInMachine } from './sign-in-machine'
import { createVerifyEmailMachine } from './verify-email.machine'
import { VerifyEmailService } from './verify-email.service'

const ann: SignInForm = {
  email: 'ann@example.test',
  password: 'Secret-ann1',
  name: 'Ann',
  locale: 'es',
}

let opened: TestSession

beforeEach(async () => {
  opened = await openTestSession()
})

afterEach(async () => {
  await opened.close()
})

/** The submit of Ann's form, the password typed again the same. */
const submitted = {
  type: 'user.sign-in.submit-button' as const,
  form: ann,
  confirmation: ann.password,
}

/** The sign-in form over the session, as the page runs it. */
const form = () => createActor(createSignInMachine(new SignInService(opened.session))).start()

/** The page of a verification link over the session. */
function linkPage(link: string) {
  const service = new VerifyEmailService(opened.session)
  const actor = createActor(
    createVerifyEmailMachine({
      token: link,
      verify: (token) => service.verify(token),
      resend: (email) => service.resend(email),
    }),
  ).start()

  return { actor }
}

describe('a banned account at sign-in', () => {
  /** Ann's account, verified on this device and signed out again, then banned. */
  async function annBanned(): Promise<void> {
    expect((await signUpVerified(opened.session, opened.auth, ann)).isOk()).toBe(true)
    expect((await opened.session.signOut()).isOk()).toBe(true)
    opened.auth.ban(ann.email)
  }

  it('is refused as banned once its password is right, signing nothing in, as the form shows it', async () => {
    await annBanned()

    const actor = form()
    const emitted: unknown[] = []

    actor.on('*', (event) => emitted.push(event))
    actor.send(submitted)

    const refused = await waitFor(actor, (state) => state.context.error !== undefined)

    // The form stays in the mode sign-in: the email is not unverified, so no resend is offered.
    expect(refused.value).toBe('sign-in')
    expect(refused.context.error).toBe('data:ACCOUNT_BANNED')
    expect(refused.can({ type: 'user.sign-in.resend-button', email: ann.email })).toBe(false)
    expect(refused.can(submitted)).toBe(true)
    expect(emitted).toEqual([])
    expect(opened.session.current()).toBeUndefined()
  })

  it('is told by the service as it is, never as a limit of devices', async () => {
    await annBanned()

    const refused = (await new SignInService(opened.session).signIn(ann, false))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
  })

  it('is refused the same when the dialog past the limit of devices confirms the sign-in', async () => {
    await annBanned()
    opened.auth.atDeviceLimit(ann.email)

    const service = new SignInService(opened.session)

    expect((await service.signIn(ann, true))._unsafeUnwrapErr().code).toBe('data:ACCOUNT_BANNED')
    expect(opened.session.current()).toBeUndefined()
  })

  it('signs in again once the ban is lifted', async () => {
    await annBanned()
    opened.auth.ban(ann.email, false)

    const actor = form()

    actor.send(submitted)
    await waitFor(actor, (state) => state.matches('done'))

    expect(opened.session.current()?.email).toBe(ann.email)
  })

  it('is told its email is not verified before it is told it is banned', async () => {
    expect((await opened.session.signUp(ann)).isOk()).toBe(true)
    opened.auth.ban(ann.email)

    const actor = form()

    actor.send(submitted)

    const refused = await waitFor(actor, (state) => state.context.error !== undefined)

    expect(refused.value).toBe('unverified')
    expect(refused.context.error).toBe('data:EMAIL_NOT_VERIFIED')
  })
})

describe('the link of a banned account', () => {
  it('verifies the email and signs nothing in: the page ends banned, offering no new link', async () => {
    expect((await opened.session.signUp(ann)).isOk()).toBe(true)
    opened.auth.ban(ann.email)

    const { actor } = linkPage(opened.auth.linkFor(ann.email))
    const ended = await waitFor(actor, (state) => state.status === 'done')

    expect(ended.value).toBe('banned')
    expect(ended.context.error).toBe('data:ACCOUNT_BANNED')
    expect(ended.can({ type: 'user.verify-email.resend-button', email: ann.email })).toBe(false)
    expect(opened.session.current()).toBeUndefined()

    // The email is verified all the same: once the ban is lifted the account signs in.
    opened.auth.ban(ann.email, false)

    expect((await new SignInService(opened.session).signIn(ann, false)).isOk()).toBe(true)
    expect(opened.session.current()?.email).toBe(ann.email)
  })
})
