import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory, settingsIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import {
  type AccountStart,
  AccountStartService,
  type KeptStartPort,
  type StartTurns,
} from './account-start.service'
import { type NewProfile, ProfileService } from './profile.service'
import { settingsCommands, settingsShape } from './settings/settings.model.gen'
import { type NewSettings, SettingsService } from './settings/settings.service'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

/** Each turn at once: a single tab. */
const inTurn: StartTurns = (run) => run()

/** The one start a browser keeps, in memory. */
function keptHere(): KeptStartPort & { readonly now: () => AccountStart | undefined } {
  let start: AccountStart | undefined

  return {
    keep: (next) => {
      start = next
    },
    kept: () => start,
    forget: () => {
      start = undefined
    },
    now: () => start,
  }
}

/**
 * The account's records as a device holds them: what was created, in order, read back by the
 * account; the profile's creation refused while `refuseProfile` says so.
 */
function records() {
  const settings: NewSettings[] = []
  const profiles: NewProfile[] = []
  const created: string[] = []
  let refuseProfile = false

  return {
    created,
    settingsRows: () => settings,
    profileRows: () => profiles,
    refuseProfiles: (refuse: boolean) => {
      refuseProfile = refuse
    },
    settings: {
      read: () => okAsync(settings.map(({ id, locale }) => ({ id, locale }))),
      createSettings: (row: NewSettings) => {
        settings.push(row)
        created.push('settings')

        return okAsync(undefined)
      },
    },
    profiles: {
      read: () =>
        okAsync(
          profiles.map(({ id, name, email }) => ({ id, name, email, created_at: new Date() })),
        ),
      createProfile: (row: NewProfile) => {
        if (refuseProfile) {
          return errAsync(dataError('data:WRITE_FAILED', 'not stored'))
        }

        profiles.push(row)
        created.push('profile')

        return okAsync(undefined)
      },
    },
  }
}

describe('AccountStartService', () => {
  it('starts a new account with its settings, then its profile, under ids derived from its identity, and keeps nothing once both exist', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)

    expect((await starts.start(ann, { name: 'Ann', locale: 'es' })).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])

    const [settings] = held.settingsRows()
    const [profile] = held.profileRows()

    expect(settings).toMatchObject({ identity: ann.id, locale: 'es' })
    expect(profile).toMatchObject({ identity: ann.id, name: 'Ann', email: ann.email })
    // The same ids on every device: the identity's own, under each record's prefix.
    expect(settingsIdFactory.is(settings?.id)).toBe(true)
    expect(profileIdFactory.is(profile?.id)).toBe(true)
    expect(settings?.id.slice(4)).toBe(ann.id.slice(4))
    expect(profile?.id.slice(4)).toBe(ann.id.slice(4))
    expect(kept.now()).toBeUndefined()
  })

  it('refuses a name the profile would refuse before it writes or keeps anything', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)

    expect((await starts.start(ann, { name: '  ', locale: 'en' }))._unsafeUnwrapErr().code).toBe(
      'profile:NAME_REQUIRED',
    )
    expect(held.created).toEqual([])
    expect(kept.now()).toBeUndefined()
  })

  it('keeps a start whose profile could not be created, and the next open of its space here creates exactly that profile', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)

    held.refuseProfiles(true)

    expect((await starts.start(ann, { name: 'Ann', locale: 'es' }))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_FAILED',
    )
    expect(held.created).toEqual(['settings'])
    expect(kept.now()).toEqual({ identity: ann.id, name: 'Ann', locale: 'es', afterPull: false })

    held.refuseProfiles(false)

    expect((await starts.resume(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])
    expect(held.profileRows()).toMatchObject([{ identity: ann.id, name: 'Ann', email: ann.email }])
    expect(kept.now()).toBeUndefined()

    // Nothing is left to finish: another open creates nothing.
    expect((await starts.resume(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])
  })

  it("creates nothing on the open of another account's space, nor where nothing was kept", async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)
    const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

    expect((await starts.resume(ann)).isOk()).toBe(true)

    kept.keep({ identity: ann.id, name: 'Ann', locale: 'en', afterPull: false })

    expect((await starts.resume(bob)).isOk()).toBe(true)
    expect(held.created).toEqual([])
  })

  it('reads the kept start in its turn: one another tab finished meanwhile creates nothing', async () => {
    const kept = keptHere()
    const held = records()
    let letRun = () => {}
    const waiting = new Promise<void>((resolve) => {
      letRun = resolve
    })
    // The turn comes once another tab's turn ended.
    const later: StartTurns = (run) => ResultAsync.fromSafePromise(waiting).andThen(() => run())
    const starts = new AccountStartService(held.profiles, held.settings, kept, later)

    kept.keep({ identity: ann.id, name: 'Ann', locale: 'en', afterPull: false })

    const resuming = starts.resume(ann)

    // Another tab finished the start in its turn, and forgot it.
    kept.forget()
    letRun()

    expect((await resuming).isOk()).toBe(true)
    expect(held.created).toEqual([])
  })
})

describe('AccountStartService, for a start a sign-in learnt of', () => {
  it('keeps it until the pull, creating nothing as the space opens, and only what is missing after', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)

    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)
    expect(kept.now()).toEqual({ identity: ann.id, name: 'Ann', locale: 'es', afterPull: true })

    // The space opens before the device pulled: nothing is created.
    expect((await starts.resume(ann)).isOk()).toBe(true)
    expect(held.created).toEqual([])

    // The pull brought the settings another device made: only the profile is missing.
    expect(
      (
        await held.settings.createSettings({
          id: settingsIdFactory.create(),
          identity: ann.id,
          locale: 'en',
        })
      ).isOk(),
    ).toBe(true)
    held.created.splice(0)

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['profile'])
    expect(held.settingsRows()).toHaveLength(1)
    expect(kept.now()).toBeUndefined()
  })

  it('keeps nothing for a name the profile would refuse', () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)

    expect(starts.keepAfterPull(ann, { name: '  ', locale: 'en' })._unsafeUnwrapErr().code).toBe(
      'profile:NAME_REQUIRED',
    )
    expect(kept.now()).toBeUndefined()
  })

  it("finishes after the pull a start the first verification kept, and nobody else's", async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn)
    const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

    kept.keep({ identity: ann.id, name: 'Ann', locale: 'en', afterPull: false })

    expect((await starts.resumeAfterPull(bob)).isOk()).toBe(true)
    expect(held.created).toEqual([])
    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])
  })
})

describe('AccountStartService on a session', () => {
  let opened: TestSession
  let profiles: ProfileService
  let settings: SettingsService

  beforeEach(async () => {
    opened = await openTestSession()
    profiles = new ProfileService(opened.runner, opened.commands, {
      shape: profileShape,
      commands: profileCommands,
    })
    settings = new SettingsService(opened.runner, opened.commands, {
      shape: settingsShape,
      commands: settingsCommands,
    })
  })

  afterEach(async () => {
    await opened.close()
  })

  it('finishes a start left without its profile, with no second settings and no second profile, however often it is resumed', async () => {
    const input = {
      email: 'ann@example.test',
      password: 'Pass-word-1',
      name: 'Ann',
      locale: 'es' as const,
    }

    expect((await opened.session.signUp(input)).isOk()).toBe(true)

    const verified = (
      await opened.session.verifyEmail(opened.auth.linkFor(input.email))
    )._unsafeUnwrap()
    const user = verified.kind === 'signed-in' ? verified.user : expect.unreachable('signed in')
    const kept = keptHere()
    let refuse = true
    const failing = new AccountStartService(
      {
        read: (owner) => profiles.read(owner),
        createProfile: (profile) =>
          refuse
            ? errAsync(dataError('data:WRITE_FAILED', 'not stored'))
            : profiles.createProfile(profile),
      },
      settings,
      kept,
      inTurn,
    )

    expect((await failing.start(user, { name: 'Ann', locale: 'es' })).isErr()).toBe(true)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])

    refuse = false

    // Two opens of the space at once, as two tabs of the browser would: one of each record.
    const resumed = await Promise.all([failing.resume(user), failing.resume(user)])

    expect(resumed.some((each) => each.isOk())).toBe(true)
    expect((await failing.resume(user)).isOk()).toBe(true)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { locale: 'es' },
    ])
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: input.email },
    ])
    expect(kept.now()).toBeUndefined()
  })
})
