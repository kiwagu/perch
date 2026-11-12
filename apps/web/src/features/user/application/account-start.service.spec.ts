import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory, settingsIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import type { Theme } from '../../../platform/theme'
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

/** The theme the device shows as an account starts there. */
const shows = (): Theme => 'dark'

/** Each turn at once: a single tab, whose store shows what its document holds. */
const inTurn: StartTurns = (run) => run(() => okAsync(undefined))

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
      read: () => okAsync(settings.map(({ id, locale, theme }) => ({ id, locale, theme }))),
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
  it('keeps the start until the pull, then creates the settings and then the profile, under ids derived from the identity, and keeps nothing once both exist', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn, shows)

    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)
    expect(kept.now()).toEqual({ identity: ann.id, name: 'Ann', locale: 'es' })
    expect(held.created).toEqual([])

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])

    const [settings] = held.settingsRows()
    const [profile] = held.profileRows()

    expect(settings).toMatchObject({ identity: ann.id, locale: 'es', theme: 'dark' })
    expect(profile).toMatchObject({ identity: ann.id, name: 'Ann', email: ann.email })
    // The same ids on every device: the identity's own, under each record's prefix.
    expect(settingsIdFactory.is(settings?.id)).toBe(true)
    expect(profileIdFactory.is(profile?.id)).toBe(true)
    expect(settings?.id.slice(4)).toBe(ann.id.slice(4))
    expect(profile?.id.slice(4)).toBe(ann.id.slice(4))
    expect(kept.now()).toBeUndefined()
  })

  it('keeps nothing for a name the profile would refuse', () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn, shows)

    expect(starts.keepAfterPull(ann, { name: '  ', locale: 'en' })._unsafeUnwrapErr().code).toBe(
      'profile:NAME_REQUIRED',
    )
    expect(kept.now()).toBeUndefined()
  })

  it('creates only what the pull left missing', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn, shows)

    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)

    // The pull brought the settings another device made: only the profile is missing.
    expect(
      (
        await held.settings.createSettings({
          id: settingsIdFactory.create(),
          identity: ann.id,
          locale: 'en',
          theme: 'light',
        })
      ).isOk(),
    ).toBe(true)
    held.created.splice(0)

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['profile'])
    expect(held.settingsRows()).toHaveLength(1)
    expect(kept.now()).toBeUndefined()
  })

  it('keeps a start whose profile could not be created, and the next finish creates exactly that profile', async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn, shows)

    held.refuseProfiles(true)

    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)
    expect((await starts.resumeAfterPull(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(held.created).toEqual(['settings'])
    expect(kept.now()).toEqual({ identity: ann.id, name: 'Ann', locale: 'es' })

    held.refuseProfiles(false)

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])
    expect(held.profileRows()).toMatchObject([{ identity: ann.id, name: 'Ann', email: ann.email }])
    expect(kept.now()).toBeUndefined()

    // Nothing is left to finish: another finish creates nothing.
    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['settings', 'profile'])
  })

  it("creates nothing for another account's start, nor where nothing was kept", async () => {
    const kept = keptHere()
    const held = records()
    const starts = new AccountStartService(held.profiles, held.settings, kept, inTurn, shows)
    const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)

    kept.keep({ identity: ann.id, name: 'Ann', locale: 'en' })

    expect((await starts.resumeAfterPull(bob)).isOk()).toBe(true)
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
    const later: StartTurns = (run) =>
      ResultAsync.fromSafePromise(waiting).andThen(() => run(() => okAsync(undefined)))
    const starts = new AccountStartService(held.profiles, held.settings, kept, later, shows)

    kept.keep({ identity: ann.id, name: 'Ann', locale: 'en' })

    const resuming = starts.resumeAfterPull(ann)

    // Another tab finished the start in its turn, and forgot it.
    kept.forget()
    letRun()

    expect((await resuming).isOk()).toBe(true)
    expect(held.created).toEqual([])
  })
})

/**
 * The account's records in a document whose projection lags: a create the document refuses for a
 * record it holds, while the store the reads see shows only what was projected so far.
 */
function lagging() {
  const inDocument = { settings: [] as NewSettings[], profiles: [] as NewProfile[] }
  let shown = { settings: [] as NewSettings[], profiles: [] as NewProfile[] }
  const created: string[] = []
  const exists = (key: string) =>
    errAsync(dataError('data:WRITE_REJECTED', `${key} already exists`))

  return {
    created,
    inDocument,
    /** The projection catches up with the document. */
    project: () => {
      shown = { settings: [...inDocument.settings], profiles: [...inDocument.profiles] }

      return okAsync(undefined)
    },
    settings: {
      read: () => okAsync(shown.settings.map(({ id, locale, theme }) => ({ id, locale, theme }))),
      createSettings: (row: NewSettings) => {
        if (inDocument.settings.some(({ id }) => id === row.id)) {
          return exists(row.id)
        }

        inDocument.settings.push(row)
        created.push('settings')

        return okAsync(undefined)
      },
    },
    profiles: {
      read: () =>
        okAsync(
          shown.profiles.map(({ id, name, email }) => ({
            id,
            name,
            email,
            created_at: new Date(),
          })),
        ),
      createProfile: (row: NewProfile) => {
        if (inDocument.profiles.some(({ id }) => id === row.id)) {
          return exists(row.id)
        }

        inDocument.profiles.push(row)
        created.push('profile')

        return okAsync(undefined)
      },
    },
  }
}

describe('AccountStartService over a projection that lags', () => {
  /** The settings another device made, which this device pulled into its document. */
  const pulledSettings = (held: ReturnType<typeof lagging>) => {
    held.inDocument.settings.push({
      id: settingsIdFactory.brand(`stg_${ann.id.slice(ann.id.indexOf('_') + 1)}`),
      identity: ann.id,
      locale: 'en',
      theme: 'light',
    })
  }

  it('creates nothing over a record its document holds once its turn projected it first', async () => {
    const held = lagging()
    const kept = keptHere()
    // The turn projects what the tab pulled before the start reads, as the browser's turns do.
    const projecting: StartTurns = (run) => held.project().andThen(() => run(held.project))
    const starts = new AccountStartService(held.profiles, held.settings, kept, projecting, shows)

    pulledSettings(held)
    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['profile'])
    expect(held.inDocument.settings).toMatchObject([{ locale: 'en' }])
    expect(kept.now()).toBeUndefined()
  })

  it('counts a create the document refuses for a record it holds as done, once projected', async () => {
    const held = lagging()
    const kept = keptHere()
    // The record reaches the document after the read: the turn's first projection missed it.
    const late: StartTurns = (run) => run(held.project)
    const starts = new AccountStartService(held.profiles, held.settings, kept, late, shows)

    pulledSettings(held)
    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)

    expect((await starts.resumeAfterPull(ann)).isOk()).toBe(true)
    expect(held.created).toEqual(['profile'])
    expect(held.inDocument.settings).toHaveLength(1)
    expect(kept.now()).toBeUndefined()
  })

  it('keeps the start when a create fails and no record shows after it', async () => {
    const held = lagging()
    const kept = keptHere()
    const failing = {
      ...held.profiles,
      createProfile: () => errAsync(dataError('data:WRITE_FAILED', 'not written')),
    }
    const starts = new AccountStartService(
      failing,
      held.settings,
      kept,
      (run) => run(held.project),
      shows,
    )

    expect(starts.keepAfterPull(ann, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)

    expect((await starts.resumeAfterPull(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(kept.now()).toMatchObject({ identity: ann.id })
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

  it('finishes a start left without its profile, with no second settings and no second profile, however often it is finished', async () => {
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
      shows,
    )

    expect(failing.keepAfterPull(user, { name: 'Ann', locale: 'es' }).isOk()).toBe(true)
    expect((await failing.resumeAfterPull(user)).isErr()).toBe(true)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])

    refuse = false

    // Two finishes at once, as two tabs of the browser would: one of each record.
    const resumed = await Promise.all([
      failing.resumeAfterPull(user),
      failing.resumeAfterPull(user),
    ])

    expect(resumed.some((each) => each.isOk())).toBe(true)
    expect((await failing.resumeAfterPull(user)).isOk()).toBe(true)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { locale: 'es', theme: 'dark' },
    ])
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: input.email },
    ])
    expect(kept.now()).toBeUndefined()
  })
})
