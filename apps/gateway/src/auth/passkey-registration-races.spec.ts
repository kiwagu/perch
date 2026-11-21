import { describe, expect, it, vi } from 'vitest'

import { z } from '@workspace/zod'

import { ban } from './__fixtures__/account-ban'
import { challengeValue } from './auth-handler'
import { turnsReach } from './auth-handler/__fixtures__/code-step'
import {
  ANN,
  ARGON2_WAIT,
  heldQueries,
  holdTurn,
  isSessionLookup,
  isVerificationInsert,
  mountedOnRealAuth,
  postTo,
  type SignedInAccount,
  signedInOn,
  turnsAsked,
} from './auth-handler/__fixtures__/mount'
import {
  authenticator,
  deletionLinkOf,
  passkeysOf,
  registrationsOf,
  resetLinkOf,
} from './auth-handler/__fixtures__/passkey'

/** The client address a change comes from. */
const FROM = '203.0.113.9'

/** How long a test of several password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const unauthorized = { status: 401, body: { code: 'unauthorized' } }

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** Better Auth's adapter writes a passkey with an insert into its table. */
const isPasskeyInsert = (text: string): boolean =>
  text.startsWith('INSERT') && text.includes('`passkey`')

/**
 * A change of Ann's account that takes the account's turn and ends its sessions, and whether her
 * passkeys outlive it: a deletion takes them and her pending registrations with the account; a ban
 * and a reset leave them as they are.
 */
interface Change {
  readonly name: string
  readonly keepsPasskeys: boolean
  /** Prepares the change before the race; the change itself answers the status it committed with. */
  prepare(mounted: Mounted, ann: SignedInAccount): Promise<() => Promise<number | undefined>>
}

const CHANGES: readonly Change[] = [
  {
    name: "the account's deletion",
    keepsPasskeys: false,
    prepare: async (mounted, ann) => {
      const token = await deletionLinkOf(mounted, ann.on('laptop'), FROM)

      return async () =>
        (await mounted.route(postTo('/auth/delete-account', { token }), FROM))?.status
    },
  },
  {
    name: "an operator's ban",
    keepsPasskeys: true,
    // The console's ban takes the account's turn.
    prepare: async (mounted, ann) => async () => {
      await mounted.turns.run(ann.identity, () =>
        ban(mounted.local, ann.identity, new Date(mounted.clock.now())),
      )

      return 200
    },
  },
  {
    name: 'a reset of the password',
    keepsPasskeys: true,
    prepare: async (mounted) => {
      const token = await resetLinkOf(mounted, FROM)

      return async () =>
        (
          await mounted.route(
            postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }),
            FROM,
          )
        )?.status
    },
  },
]

/** The two calls of a registration, each in the account's turn. */
interface Call {
  readonly name: string
  /** The status the call answers when it runs before the change. */
  readonly status: number
  /** What Better Auth writes in the call, which a test holds to keep the call in its turn. */
  readonly write: (text: string) => boolean
  /** Prepares the call before the race (the options of an add); the call itself answers. */
  prepare(
    passkeys: ReturnType<typeof passkeysOf>,
    ann: SignedInAccount,
  ): Promise<() => Promise<{ status: number; body: unknown }>>
}

const CALLS: readonly Call[] = [
  {
    name: 'options',
    status: 200,
    write: isVerificationInsert,
    prepare: async (passkeys, ann) => () => passkeys.options(ann.on('laptop')),
  },
  {
    name: 'add',
    status: 201,
    write: isPasskeyInsert,
    prepare: async (passkeys, ann) => {
      const body = await passkeys.made(ann.on('laptop'), authenticator())

      return () => passkeys.add(ann.on('laptop'), body)
    },
  },
]

const RACES = CHANGES.flatMap((change) => CALLS.map((call) => ({ change, call })))

describe("passkeyRoutes, a registration and a change of the account in the account's turn", () => {
  it.each(RACES)(
    'answers 401 to the $call.name of a registration that waited for the turn in which $change.name committed, adding nothing',
    async ({ change, call }) => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const registering = await call.prepare(passkeys, ann)
      const before = await registrationsOf(mounted, ann.identity)
      const changing = await change.prepare(mounted, ann)
      const asked = turnsAsked(mounted.turns)
      // The account's turn is under way: the change asks for it first, the registration after it.
      const release = await holdTurn(mounted.turns, ann.identity)
      const committed = changing()

      await turnsReach(asked, ann.identity, 2)

      const answering = registering()

      await turnsReach(asked, ann.identity, 3)
      release()

      expect(await committed).toBe(200)
      expect(await answering).toEqual(unauthorized)

      const after = await registrationsOf(mounted, ann.identity)

      expect(after.passkeys).toEqual([])
      expect(after.registrations).toEqual(change.keepsPasskeys ? before.registrations : [])
    },
    ARGON2_RUNS_MS,
  )

  it.each(RACES)(
    'answers the $call.name of a registration whose turn came before $change.name, which then leaves the passkeys as it leaves them',
    async ({ change, call }) => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const registering = await call.prepare(passkeys, ann)
      const changing = await change.prepare(mounted, ann)
      const asked = turnsAsked(mounted.turns)
      const write = queries.hold(call.write)
      const answering = registering()

      // Better Auth is about to write the challenge or the passkey, in the registration's turn; the
      // change asks for the turn meanwhile.
      await vi.waitFor(() => expect(write.paused()).toBe(true), ARGON2_WAIT)

      const committed = changing()

      await turnsReach(asked, ann.identity, 2)
      write.release()

      expect((await answering).status).toBe(call.status)
      expect(await committed).toBe(200)

      const after = await registrationsOf(mounted, ann.identity)

      expect(after.passkeys).toHaveLength(change.keepsPasskeys && call.name === 'add' ? 1 : 0)

      if (!change.keepsPasskeys) {
        expect(after.registrations).toEqual([])
      }
    },
    ARGON2_RUNS_MS,
  )
})

describe('passkeyRoutes, a registration and an ending of its session that takes no turn', () => {
  it.each(CALLS)(
    "answers 401 to the $name of a registration whose session ended between the gateway's read of it and Better Auth's",
    async (call) => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const registering = await call.prepare(passkeys, ann)
      const asked = turnsAsked(mounted.turns)
      const release = await holdTurn(mounted.turns, ann.identity)
      const answering = registering()

      // The call read the session once before it asked for the turn; in the turn the gateway reads
      // it again, then Better Auth reads it: that second read waits while the device signs out.
      await turnsReach(asked, ann.identity, 2)

      let reads = 0
      const plugin = queries.hold((text) => isSessionLookup(text) && ++reads === 2)

      release()
      await vi.waitFor(() => expect(plugin.paused()).toBe(true), ARGON2_WAIT)
      expect((await mounted.sessions.signOut(ann.tokens.get('laptop') ?? '')).isOk()).toBe(true)
      plugin.release()

      expect(await answering).toEqual(unauthorized)
      expect((await registrationsOf(mounted, ann.identity)).passkeys).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it.each(CALLS)(
    'answers the $name of a registration whose session ended once Better Auth read it, as for one just before a sign-out',
    async (call) => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const registering = await call.prepare(passkeys, ann)
      const write = queries.hold(call.write)
      const answering = registering()

      await vi.waitFor(() => expect(write.paused()).toBe(true), ARGON2_WAIT)
      expect((await mounted.sessions.signOut(ann.tokens.get('laptop') ?? '')).isOk()).toBe(true)
      write.release()

      const { status, body } = await answering

      expect(status).toBe(call.status)

      const after = await registrationsOf(mounted, ann.identity)

      if (call.name === 'options') {
        expect(
          challengeValue.safeParse(z.object({ challenge: z.string() }).parse(body).challenge)
            .success,
        ).toBe(true)
        expect(after.registrations).toHaveLength(1)
      } else {
        expect(after.passkeys).toHaveLength(1)
      }
    },
    ARGON2_RUNS_MS,
  )
})
