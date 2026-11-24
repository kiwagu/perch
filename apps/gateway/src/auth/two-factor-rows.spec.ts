import { afterEach, describe, expect, it } from 'vitest'

import { identityIdFactory, idSchemas, two_factorIdFactory } from '@workspace/ids'

import { deviceHeaders, type OpenedAuth, openAuth, signUpOn } from './__fixtures__/auth-instance'
import { passwordStepRequest, secondFactorOn, stateOf } from './__fixtures__/second-factor'
import twoFactorChallengeRowsStatement from './__fixtures__/two-factor-challenge-rows.surql'
import { TwoFactorRows } from './two-factor-rows'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'

const BOB = 'bob@example.test'

/** An account signed up on its own device: its identity, its token and the device. */
async function signedUp(opened: OpenedAuth, email: string, device: string) {
  const { token, user } = await signUpOn(opened.auth, email, deviceHeaders(device))

  return { identity: idSchemas.identity.schema.parse(user.id), token, device }
}

/** Better Auth's enable for the account signed in with `token` on `device`: a key not confirmed. */
async function started(opened: OpenedAuth, account: { token: string; device: string }) {
  const headers = deviceHeaders(account.device)

  headers.set('authorization', `Bearer ${account.token}`)
  await opened.auth.api.enableTwoFactor({ body: { password: 'Pass-word-1' }, headers })
}

async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  return {
    opened,
    rows: new TwoFactorRows(opened.local),
    ann: await signedUp(opened, ANN, 'laptop'),
    bob: await signedUp(opened, BOB, 'desk'),
  }
}

describe('TwoFactorRows', () => {
  it("reads whether an account's factor is on and the key its row holds, none before an enable", async () => {
    const { opened, rows, ann } = await harness()

    expect((await rows.read(ann.identity))._unsafeUnwrap()).toEqual({
      enabled: false,
      key: undefined,
    })

    await started(opened, ann)

    const { rows: kept } = await stateOf(opened, ann.identity)
    const state = (await rows.read(ann.identity))._unsafeUnwrap()

    expect(state.enabled).toBe(false)
    expect(state.key).toEqual({
      enrolment: kept[0]?.id,
      secret: kept[0]?.secret,
      verified: false,
    })
  }, 30_000)

  it("confirms an account's own enrolment once: the flag and the row's confirmation change together", async () => {
    const { opened, rows, ann } = await harness()

    await started(opened, ann)

    const [row] = (await stateOf(opened, ann.identity)).rows
    const enrolment = idSchemas.two_factor.schema.parse(row?.id)

    expect((await rows.confirm(ann.identity, enrolment))._unsafeUnwrap()).toBe('confirmed')

    const on = await stateOf(opened, ann.identity)

    expect(on.enabled).toBe(true)
    expect(on.rows.map((each) => [each.id, each.verified])).toEqual([[enrolment, true]])
    // The factor is on: the same enrolment confirms nothing again.
    expect((await rows.confirm(ann.identity, enrolment))._unsafeUnwrap()).toBe('changed')
  }, 30_000)

  it("changes nothing for an enrolment that is not the account own row: a replaced one, another account's, one no row holds, an identity that is gone", async () => {
    const { opened, rows, ann, bob } = await harness()

    await started(opened, ann)

    const [first] = (await stateOf(opened, ann.identity)).rows

    // A second enable replaces the row: the first enrolment names a key that is gone.
    await started(opened, ann)
    await started(opened, bob)

    const [second] = (await stateOf(opened, ann.identity)).rows
    const [bobs] = (await stateOf(opened, bob.identity)).rows
    const before = await stateOf(opened, ann.identity)

    expect(second?.id).not.toBe(first?.id)

    for (const enrolment of [first?.id, bobs?.id, two_factorIdFactory.create()]) {
      expect(
        (
          await rows.confirm(ann.identity, idSchemas.two_factor.schema.parse(enrolment))
        )._unsafeUnwrap(),
      ).toBe('changed')
    }

    expect(await stateOf(opened, ann.identity)).toEqual(before)
    expect((await stateOf(opened, bob.identity)).enabled ?? false).toBe(false)

    // An identity that is not there is not created by the confirmation.
    const gone = identityIdFactory.create()

    expect(
      (await rows.confirm(gone, idSchemas.two_factor.schema.parse(second?.id)))._unsafeUnwrap(),
    ).toBe('changed')
    expect(await stateOf(opened, gone)).toEqual({ enabled: undefined, rows: [] })
  }, 60_000)

  it("turns an account's factor off with its key and its pending challenges, and no other account's", async () => {
    const { opened, rows, ann, bob } = await harness()

    await secondFactorOn(opened.auth, ann.device, ann.token)
    await secondFactorOn(opened.auth, bob.device, bob.token)

    // Each account's password step left a challenge, with the row counting its codes.
    for (const email of [ANN, BOB]) {
      const answered = await opened.auth.handler(passwordStepRequest(email, 'Pass-word-1', 'phone'))

      expect(await answered.json()).toEqual({
        twoFactorRedirect: true,
        twoFactorMethods: ['totp'],
      })
    }

    /** How many rows Better Auth keeps for pending challenges: each one's row and its count. */
    const challengeRows = async () =>
      (await opened.local.db.query<[string[]]>(twoFactorChallengeRowsStatement))[0]

    expect(await challengeRows()).toHaveLength(4)
    expect((await rows.disable(ann.identity)).isOk()).toBe(true)
    // Ann's challenge and its count went; Bob's stay.
    expect(await challengeRows()).toHaveLength(2)

    const off = await stateOf(opened, ann.identity)

    expect(off.enabled).toBe(false)
    expect(off.rows).toEqual([])

    const kept = await stateOf(opened, bob.identity)

    expect(kept.enabled).toBe(true)
    expect(kept.rows).toHaveLength(1)

    // Off already: nothing changes, and it is no failure.
    expect((await rows.disable(ann.identity)).isOk()).toBe(true)
    expect(await stateOf(opened, ann.identity)).toEqual(off)
  }, 60_000)
})
