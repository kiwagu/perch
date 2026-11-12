import { err } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'

import { AccountStartService } from '../../features/user/application/account-start.service'
import { ProfileService } from '../../features/user/application/profile.service'
import {
  settingsCommands,
  settingsShape,
} from '../../features/user/application/settings/settings.model.gen'
import { SettingsService } from '../../features/user/application/settings/settings.service'
import {
  profileCommands,
  profileShape,
} from '../../features/user/presentation/pages/profile/profile.model.gen'
import {
  type FakeGatewayAuth,
  fakeGatewayAuth,
  verifiedElsewhere,
} from '../__fixtures__/gateway-auth'
import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { keptAccountStart, savedSession } from '../storage'

import { ensureAccount } from './accounts'
import type { AccountInput, Inbox, SeedDevice, SeedStarts } from './types'

const ann: AccountInput = {
  email: 'ann@example.test',
  password: 'Pass-word-1',
  name: 'Ann',
  bio: 'Seeded.',
  locale: 'es',
}

/** Another device, where an account's link may be opened first. */
const elsewhere = { id: 'elsewhere', label: 'Edge on Windows' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

/**
 * The stand's mailbox over the fake gateway: the mails to an email are the links it mailed, each
 * look recorded. `beforeToken` runs on a link before it is answered.
 */
function fakeInbox(
  auth: FakeGatewayAuth,
  beforeToken: (token: string) => Promise<void> = () => Promise.resolve(),
) {
  const asked: string[] = []
  const inbox: Inbox = {
    count: (email) => {
      asked.push(`count ${email}`)

      return Promise.resolve(auth.mailsTo(email).length)
    },
    verificationToken: async (email, seen) => {
      asked.push(`token ${email} after ${seen}`)

      const token = auth.mailsTo(email)[seen]

      if (token === undefined) {
        throw new Error(`no mail ${seen + 1} came to ${email}`)
      }

      await beforeToken(token)

      return token
    },
  }

  return { asked, inbox }
}

/**
 * A seed device over a test world of the fake gateway: the session, the account's services, the
 * starts of new accounts as the app composes them over the browser's storage, `inbox`. With
 * `beside`, the app finishes the start it kept, as the root does once the space is open, in
 * `beside` (what each finish answered), while the seed goes on.
 */
async function device(auth: FakeGatewayAuth, inbox: Inbox, beside?: Promise<boolean>[]) {
  const tab: { starts?: AccountStartService } = {}
  const world = await openTestWorld({
    auth,
    online: false,
    keepAccountStart: (signIn, user, from) => tab.starts?.keepAfterPull(signIn, user, from),
  })

  worlds.push(world)

  const { session, commands } = world
  const profiles = new ProfileService(session.runner, commands, {
    shape: profileShape,
    commands: profileCommands,
  })
  const settings = new SettingsService(session.runner, commands, {
    shape: settingsShape,
    commands: settingsCommands,
  })
  const starts = new AccountStartService(
    profiles,
    settings,
    keptAccountStart(world.storage),
    (run) => run(() => session.flush()),
    () => 'system',
  )

  tab.starts = starts

  // The seed keeps a start under the sign-in current on the device, as the seed client does.
  const seedStarts: SeedStarts = {
    keepAfterPull: (user, from) => {
      const signIn = savedSession(world.storage)?.signIn

      return signIn === undefined
        ? err(dataError('data:AUTH_FAILED', 'nobody is signed in on the seed device'))
        : starts.keepAfterPull(signIn, user, from)
    },
    resumeAfterPull: (user) => starts.resumeAfterPull(user),
  }

  if (beside) {
    world.session.subscribe((user) => {
      if (user !== undefined) {
        beside.push(
          starts.resumeAfterPull(user).match(
            () => true,
            () => false,
          ),
        )
      }
    })
  }

  const seed: SeedDevice = {
    session,
    profiles,
    settings,
    starts: seedStarts,
    inbox,
    enter: (signIn) => signIn(),
    settle: () => session.flush(),
  }

  return { seed, world }
}

/** The account's profile and settings as the device reads them. */
async function written(seed: SeedDevice, user: AuthUser) {
  const [profile] = (await seed.profiles.read({ identity: user.id }))._unsafeUnwrap()
  const [settings] = (await seed.settings.read({ identity: user.id }))._unsafeUnwrap()

  return { profile, settings }
}

describe("the seed client's account", () => {
  it('signs in an account whose email is verified, asking the mailbox nothing', async () => {
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, ann)).isOk()).toBe(true)
    auth.requests.splice(0)

    const { asked, inbox } = fakeInbox(auth)
    const { seed, world } = await device(auth, inbox)
    const seeded = (await ensureAccount(seed, ann))._unsafeUnwrap()

    expect(asked).toEqual([])
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])
    expect(world.session.current()).toEqual(seeded.user)
    expect(await written(seed, seeded.user)).toMatchObject({
      profile: { id: seeded.profileId, name: 'Ann', bio: 'Seeded.', email: ann.email },
      settings: { locale: 'es' },
    })
  })

  it('signs a new email up and verifies it through the mail its sign-up sent', async () => {
    const auth = fakeGatewayAuth()
    const { asked, inbox } = fakeInbox(auth)
    const { seed, world } = await device(auth, inbox)
    const seeded = (await ensureAccount(seed, ann))._unsafeUnwrap()
    const [link] = auth.mailsTo(ann.email)

    // The mails are counted before the sign-up, so the one it sends is the one read.
    expect(asked).toEqual([`count ${ann.email}`, `token ${ann.email} after 0`])
    expect(auth.requests).toMatchObject([
      { kind: 'sign-in' },
      { kind: 'sign-up', email: ann.email, name: 'Ann', locale: 'es' },
      { kind: 'sign-in' },
      { kind: 'verify', token: link },
    ])
    expect(world.session.current()).toEqual(seeded.user)
    expect(await written(seed, seeded.user)).toMatchObject({
      profile: { name: 'Ann', bio: 'Seeded.' },
      settings: { locale: 'es' },
    })
  })

  it("starts the account as the app does, under the ids derived from its identity, while the app's own start finishes it beside the seed: one record of each", async () => {
    const auth = fakeGatewayAuth()
    const { inbox } = fakeInbox(auth)
    const beside: Promise<boolean>[] = []
    const { seed, world } = await device(auth, inbox, beside)
    const seeded = (await ensureAccount(seed, ann))._unsafeUnwrap()
    const body = seeded.user.id.slice(seeded.user.id.indexOf('_') + 1)

    // The verification kept the start, and the app began finishing it as the space opened.
    expect(beside).toHaveLength(1)
    expect(await Promise.all(beside)).toEqual([true])

    const { profile, settings } = await written(seed, seeded.user)

    expect(settings?.id).toBe(`stg_${body}`)
    expect(profile?.id).toBe(`prf_${body}`)
    expect(seeded.profileId).toBe(`prf_${body}`)
    expect((await seed.settings.read({ identity: seeded.user.id }))._unsafeUnwrap()).toHaveLength(1)
    expect((await seed.profiles.read({ identity: seeded.user.id }))._unsafeUnwrap()).toHaveLength(1)
    expect(keptAccountStart(world.storage).kept(seeded.user.id)).toBeUndefined()
  })

  it('has the mail of an account not verified yet sent again, and opens the new link', async () => {
    const auth = fakeGatewayAuth()

    expect((await auth.signUp(ann)).isOk()).toBe(true)
    auth.requests.splice(0)

    const { asked, inbox } = fakeInbox(auth)
    const { seed, world } = await device(auth, inbox)
    const seeded = (await ensureAccount(seed, ann))._unsafeUnwrap()
    const [first, second] = auth.mailsTo(ann.email)

    expect(second).toBeDefined()
    expect(asked).toEqual([`count ${ann.email}`, `token ${ann.email} after 1`])
    expect(auth.requests).toMatchObject([
      { kind: 'sign-in' },
      { kind: 'resend', email: ann.email },
      { kind: 'verify', token: second },
    ])
    expect(auth.requests).not.toContainEqual(expect.objectContaining({ token: first }))
    expect(world.session.current()).toEqual(seeded.user)
  })

  it('signs in with the password when the link was opened before it', async () => {
    const auth = fakeGatewayAuth()
    // Someone opens the link elsewhere just before the seed does.
    const { inbox } = fakeInbox(auth, async (token) => {
      expect((await auth.verifyEmail(token, elsewhere)).isOk()).toBe(true)
    })
    const { seed, world } = await device(auth, inbox)
    const seeded = (await ensureAccount(seed, ann))._unsafeUnwrap()

    expect(auth.requests.map(({ kind }) => kind)).toEqual([
      'sign-in',
      'sign-up',
      'sign-in',
      'verify',
      'verify',
      'sign-in',
    ])
    expect(world.session.current()).toEqual(seeded.user)
  })

  it.each([
    ['verified', true],
    ['not verified yet', false],
  ] as const)(
    'fails an email whose account (%s) has another password as invalid credentials, never asking the mailbox for a mail',
    async (_, verified) => {
      const auth = fakeGatewayAuth()
      const theirs = { ...ann, password: 'Their-pass-word-1' }

      expect(
        (await (verified ? verifiedElsewhere(auth, theirs) : auth.signUp(theirs))).isOk(),
      ).toBe(true)
      auth.requests.splice(0)

      const { asked, inbox } = fakeInbox(auth)
      const { seed, world } = await device(auth, inbox)
      const failed = (await ensureAccount(seed, ann))._unsafeUnwrapErr()

      expect(failed.code).toBe('data:INVALID_CREDENTIALS')
      expect(asked.filter((look) => look.startsWith('token'))).toEqual([])
      // The sign-up of a taken email answered as a new one does, and sent nothing.
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-up', 'sign-in'])
      expect(world.session.current()).toBeUndefined()
    },
  )

  it('fails naming neither the email nor the mailbox when no mail comes', async () => {
    const auth = fakeGatewayAuth()
    const inbox: Inbox = {
      count: () => Promise.resolve(0),
      verificationToken: (email) => Promise.reject(new Error(`no mail came to ${email}`)),
    }
    const { seed, world } = await device(auth, inbox)
    const failed = (await ensureAccount(seed, ann))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(JSON.stringify(failed)).not.toContain(ann.email)
    expect('cause' in failed).toBe(false)
    expect(world.session.current()).toBeUndefined()
  })
})
