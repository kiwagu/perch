import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { sessionStates } from '../../auth/__fixtures__/account-ban'
import liveDevicesStatement from '../../auth/__fixtures__/device-sessions-live.surql'
import { AccountTeardown } from '../../auth/account-teardown'
import { holdTurn, turnsAsked } from '../../auth/auth-handler/__fixtures__/mount'
import { KeyedTurns } from '../../keyed-turns'
import { type BanState, banOf } from '../__fixtures__/ban-rows'
import {
  type Ask,
  type ConsoleAuth,
  closeConsoleAuth,
  consoleRequest,
  openConsoleAuth,
  type SignedIn,
  signedUp,
} from '../__fixtures__/operators'
import { AccountBans } from '../account-bans'
import { AccountDirectory } from '../account-directory'

import { consoleRoutes } from './routes'

afterEach(closeConsoleAuth)

/** The client address every request comes from. */
const ADDRESS = '203.0.113.1'

/** A close the routes asked for, with what the directory held of the account as it was asked. */
interface SeenClose {
  readonly identity: IdentityId
  readonly device: string | undefined
  readonly code: number
  readonly account: BanState | undefined
  /** The devices of the account whose session had not ended. */
  readonly live: readonly unknown[]
}

/** A route's answer: its status and its JSON body (none when empty). */
async function answered(response: Response | undefined) {
  if (response === undefined) {
    return expect.unreachable('the routes answered nothing')
  }

  const text = await response.text()

  return {
    status: response.status,
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
    allow: response.headers.get('Allow'),
  }
}

/** The ban of `identity`, or none for an account that is gone. */
async function banOrNone(auth: ConsoleAuth, identity: IdentityId) {
  return (await new AccountDirectory(auth.local).read(identity))._unsafeUnwrap() === undefined
    ? undefined
    : banOf(auth.local, identity)
}

/** The devices of `identity` whose session has not ended. */
async function liveDevices(auth: ConsoleAuth, identity: IdentityId): Promise<unknown[]> {
  const [devices] = await auth.local.db.query<[unknown[]]>(liveDevicesStatement, { identity })

  return devices
}

/**
 * The console's routes over an in-memory directory, with two operators (ann and cat) and an
 * account that is none (bob) signed up, the accounts' turns in `turns`; the bans and the sockets'
 * closes are recorded in order in `steps`, each close with what the directory held as it was asked.
 */
async function served(
  options: {
    readonly bans?: (real: AccountBans) => Pick<AccountBans, 'ban' | 'unban'>
    readonly sessions?: (auth: ConsoleAuth) => Pick<ConsoleAuth['sessions'], 'read' | 'revokeAll'>
  } = {},
) {
  const auth = await openConsoleAuth()
  const failures: DataError[] = []
  const steps: string[] = []
  const closes: SeenClose[] = []
  const turns = new KeyedTurns<string>()
  const bans =
    options.bans?.(new AccountBans({ directory: auth.local, clock: auth.clock })) ??
    new AccountBans({ directory: auth.local, clock: auth.clock })
  const routes = consoleRoutes({
    sessions: options.sessions?.(auth) ?? auth.sessions,
    accounts: new AccountDirectory(auth.local),
    bans: {
      ban: (identity, reason) => {
        steps.push('ban')

        return bans.ban(identity, reason).map((outcome) => {
          steps.push(`ban ${outcome}`)

          return outcome
        })
      },
      unban: (identity) => {
        steps.push('unban')

        return bans.unban(identity).map((outcome) => {
          steps.push(`unban ${outcome}`)

          return outcome
        })
      },
    },
    connections: {
      close: async (identity, device, code) => {
        steps.push(`closed ${code}`)
        closes.push({
          identity,
          device,
          code,
          account: await banOrNone(auth, identity),
          live: await liveDevices(auth, identity),
        })
      },
    },
    turns,
    onFailure: (error) => failures.push(error),
  })
  const ann = await signedUp(auth, 'ann@example.test', { role: 'operator' })
  const cat = await signedUp(auth, 'cat@example.test', { role: 'operator' })
  const bob = await signedUp(auth, 'bob@example.test')
  const ask = async (method: string, path: string, by: Ask = { as: ann }) =>
    answered(await routes(consoleRequest(method, path, by), ADDRESS))
  /** `action` asked of bob's account (or `target`'s) by `by` (ann unless named). */
  const act = (action: string, body?: unknown, target: SignedIn = bob, by: SignedIn = ann) =>
    ask('POST', `/console/accounts/${target.identity}/${action}`, { as: by, body })

  return { auth, turns, ann, cat, bob, ask, act, steps, closes, failures }
}

/** The ending of each session of `account`, by its device: when and why it ended. */
async function endingsOf(auth: ConsoleAuth, account: SignedIn) {
  return (await sessionStates(auth.local, account.identity)).map((row) => [
    row.device,
    row.ended_reason,
  ])
}

describe('consoleRoutes: POST /console/accounts/:id/ban', () => {
  it('bans the account with the reason given, ends its sessions banned, and closes its sockets 4004 once that committed', async () => {
    const { auth, bob, act, closes, failures } = await served()

    expect(await act('ban', { reason: '  spam  ' })).toEqual({
      status: 204,
      body: undefined,
      allow: null,
    })
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: true, ban_reason: 'spam' })
    expect(await endingsOf(auth, bob)).toEqual([[bob.device, 'banned']])
    expect(closes).toEqual([
      {
        identity: bob.identity,
        device: undefined,
        code: CLOSE.banned,
        account: { banned: true, ban_reason: 'spam' },
        live: [],
      },
    ])
    expect((await auth.sessions.read(bob.token)).kind).toBe('none')
    expect(failures).toEqual([])
  })

  it('bans with no reason when the body names none', async () => {
    const { auth, bob, act } = await served()

    expect((await act('ban', {})).status).toBe(204)
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: true })
  })

  it('takes a reason of 500 characters', async () => {
    const { auth, bob, act } = await served()
    const reason = 'x'.repeat(500)

    expect((await act('ban', { reason })).status).toBe(204)
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: true, ban_reason: reason })
  })

  it.each([
    { name: 'a reason over 500 characters', body: { reason: 'x'.repeat(501) } },
    { name: 'a reason that is no text', body: { reason: 7 } },
    { name: 'a body that is not JSON', body: 'not json' },
    { name: 'no body', body: undefined },
  ])('answers 400 bad-request to $name, banning nothing', async ({ body }) => {
    const { auth, bob, act, steps } = await served()

    expect(await act('ban', body)).toMatchObject({ status: 400, body: { code: 'bad-request' } })
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: false })
    expect(steps).toEqual([])
  })

  it('answers 500 internal to a ban that failed, which onFailure hears, and closes nothing', async () => {
    const error = dataError('data:WRITE_FAILED', 'the directory is gone')
    const { act, closes, failures } = await served({
      bans: (real) => ({ ban: () => errAsync(error), unban: (identity) => real.unban(identity) }),
    })

    expect(await act('ban', { reason: 'spam' })).toMatchObject({
      status: 500,
      body: { code: 'internal' },
    })
    expect(closes).toEqual([])
    expect(failures).toEqual([error])
  })
})

describe('consoleRoutes: POST /console/accounts/:id/unban', () => {
  it('lifts the ban and its reason, the sessions it ended staying ended, and closes nothing', async () => {
    const { auth, bob, act, closes } = await served()

    await act('ban', { reason: 'spam' })

    expect(await act('unban')).toEqual({ status: 204, body: undefined, allow: null })
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: false })
    expect(await endingsOf(auth, bob)).toEqual([[bob.device, 'banned']])
    expect(closes.map(({ code }) => code)).toEqual([CLOSE.banned])
  })

  it('leaves an account that is not banned as it is, its session live', async () => {
    const { auth, bob, act, closes } = await served()

    expect((await act('unban')).status).toBe(204)
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: false })
    expect((await auth.sessions.read(bob.token)).kind).toBe('session')
    expect(closes).toEqual([])
  })

  it('answers 500 internal to a lift that failed, which onFailure hears', async () => {
    const error = dataError('data:WRITE_FAILED', 'the directory is gone')
    const { act, failures } = await served({
      bans: (real) => ({
        ban: (identity, reason) => real.ban(identity, reason),
        unban: () => errAsync(error),
      }),
    })

    expect(await act('unban')).toMatchObject({ status: 500, body: { code: 'internal' } })
    expect(failures).toEqual([error])
  })
})

describe('consoleRoutes: POST /console/accounts/:id/sign-out', () => {
  it('signs every device of the account out, revoked, and closes its sockets 4001 once that committed', async () => {
    const { auth, bob, act, closes, failures } = await served()

    expect(await act('sign-out')).toEqual({ status: 204, body: undefined, allow: null })
    expect(await endingsOf(auth, bob)).toEqual([[bob.device, 'revoked']])
    expect(closes).toEqual([
      {
        identity: bob.identity,
        device: undefined,
        code: CLOSE.revoked,
        account: { banned: false },
        live: [],
      },
    ])
    expect((await auth.sessions.read(bob.token)).kind).toBe('none')
    expect(failures).toEqual([])
  })

  it('answers 500 internal to an ending that failed, which onFailure hears, and closes nothing', async () => {
    const error = dataError('data:WRITE_FAILED', 'the directory is gone')
    const { act, closes, failures } = await served({
      sessions: (auth) => ({
        read: (token) => auth.sessions.read(token),
        revokeAll: () => errAsync(error),
      }),
    })

    expect(await act('sign-out')).toMatchObject({ status: 500, body: { code: 'internal' } })
    expect(closes).toEqual([])
    expect(failures).toEqual([error])
  })
})

describe("consoleRoutes: an operator's actions on an account", () => {
  it.each([
    { action: 'ban', body: { reason: 'spam' } },
    { action: 'sign-out', body: undefined },
  ])(
    "refuses $action of the operator's own account 409 own-account before taking its turn, changing nothing",
    async ({ action, body }) => {
      const { auth, turns, ann, act, steps, closes } = await served()
      const asked = turnsAsked(turns)

      expect(await act(action, body, ann)).toMatchObject({
        status: 409,
        body: { code: 'own-account' },
      })
      expect(asked(ann.identity)).toBe(0)
      expect(await banOf(auth.local, ann.identity)).toEqual({ banned: false })
      expect((await auth.sessions.read(ann.token)).kind).toBe('session')
      expect(steps).toEqual([])
      expect(closes).toEqual([])
    },
  )

  it.each(['ban', 'unban', 'sign-out'])(
    'answers %s of an id no account has, and of an id of another form, 404 account-gone',
    async (action) => {
      const { ask, ann, closes } = await served()

      for (const id of [identityIdFactory.create(), 'nonsense']) {
        expect(
          await ask('POST', `/console/accounts/${id}/${action}`, {
            as: ann,
            body: action === 'ban' ? { reason: 'spam' } : undefined,
          }),
        ).toMatchObject({ status: 404, body: { code: 'account-gone' } })
      }

      expect(closes).toEqual([])
    },
  )

  it.each(['ban', 'unban', 'sign-out'])(
    'answers %s of an account removed while it waited for its turn 404 account-gone, closing nothing',
    async (action) => {
      const { auth, turns, bob, act, closes } = await served()
      const release = await holdTurn(turns, bob.identity)
      const asked = turnsAsked(turns)
      const acting = act(action, action === 'ban' ? { reason: 'spam' } : undefined)

      await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))
      ;(await new AccountTeardown(auth.local).remove(bob.identity))._unsafeUnwrap()
      release()

      expect(await acting).toMatchObject({ status: 404, body: { code: 'account-gone' } })
      expect(closes).toEqual([])
    },
  )

  it("runs two operators' actions on one account one after the other, in the account's turn", async () => {
    const { auth, turns, bob, cat, act, steps } = await served()
    const release = await holdTurn(turns, bob.identity)
    const asked = turnsAsked(turns)
    const banning = act('ban', { reason: 'spam' })

    // Ann's ban asks for the account's turn first, then cat's lift of it.
    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))

    const unbanning = act('unban', undefined, bob, cat)

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(2))

    // Neither runs while the account's turn is held.
    expect(steps).toEqual([])
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: false })

    release()

    expect((await banning).status).toBe(204)
    expect((await unbanning).status).toBe(204)
    expect(steps).toEqual([
      'ban',
      'ban banned',
      `closed ${CLOSE.banned}`,
      'unban',
      'unban unbanned',
    ])
    expect(await banOf(auth.local, bob.identity)).toEqual({ banned: false })
  })

  it('refuses an account that is no operator 403 not-operator, before anything is asked', async () => {
    const { auth, bob, cat, act, steps, closes } = await served()

    expect(await act('ban', { reason: 'spam' }, cat, bob)).toMatchObject({
      status: 403,
      body: { code: 'not-operator' },
    })
    expect(await act('sign-out', undefined, cat, bob)).toMatchObject({ status: 403 })
    expect(await banOf(auth.local, cat.identity)).toEqual({ banned: false })
    expect(steps).toEqual([])
    expect(closes).toEqual([])
  })

  it.each(['ban', 'unban', 'sign-out'])(
    'answers 405 with POST in Allow to another method at %s',
    async (action) => {
      const { ask, bob } = await served()

      expect(await ask('GET', `/console/accounts/${bob.identity}/${action}`)).toEqual({
        status: 405,
        body: { code: 'method-not-allowed' },
        allow: 'POST',
      })
    },
  )
})
