import { afterEach, describe, expect, it } from 'vitest'

import { fromDriverValue } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { sessionStates } from './__fixtures__/account-ban'
import { deviceHeaders, type OpenedAuth, openAuth, signUpOn } from './__fixtures__/auth-instance'
import { codeOf, passwordStepRequest, secondFactorOn } from './__fixtures__/second-factor'
import twoFactorStateStatement from './__fixtures__/two-factor-state.surql'
import { internalRequest, setCookieValue, twoFactorChallenges } from './auth-handler'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'

/** The front's origin the fixture's instance trusts and serves its routes behind. */
const ORIGIN = 'http://localhost'

/** The account's flag and its two-factor row, as the directory keeps them. */
const twoFactorState = z.object({
  enabled: z.boolean().nullish(),
  rows: z.array(z.object({ verified: z.boolean(), secret: z.string(), backup_codes: z.string() })),
})

/** The second-factor flag of `identity` and its two-factor rows. */
async function stateOf(opened: OpenedAuth, identity: string) {
  const [state] = await opened.local.db.query<[unknown]>(twoFactorStateStatement, { identity })

  return twoFactorState.parse(fromDriverValue(state))
}

/** A password step from `device`, through Better Auth's handler: the challenge its cookie carries. */
async function challengeOf(opened: OpenedAuth, device: string): Promise<string> {
  const answer = await opened.auth.handler(passwordStepRequest(ANN, 'Pass-word-1', device))

  expect(await answer.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] })

  return (
    setCookieValue(answer, await twoFactorChallenges(opened.auth, opened.local).cookieName()) ??
    expect.unreachable('a challenge cookie')
  )
}

/** The second step of a sign-in from `device`: `code` sent to `path` with the challenge. */
async function verified(opened: OpenedAuth, device: string, path: string, code: string) {
  const challenge = await challengeOf(opened, device)
  const name = await twoFactorChallenges(opened.auth, opened.local).cookieName()

  return opened.auth.handler(
    internalRequest({
      publicUrl: ORIGIN,
      path,
      device: { id: device, label: 'Firefox on Linux' },
      challenge: { name, value: challenge },
      pending: true,
      body: { code },
    }),
  )
}

const signedIn = z.object({ token: z.string().min(1), user: z.object({ id: z.string() }) })

describe("Better Auth's second factor on the directory, through the patched adapter", () => {
  it('keeps the key encrypted and unconfirmed at the enable, and turns the factor on at a code of it', async () => {
    const opened = await openAuth()

    closers.push(opened.close)

    const { token, user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
    const headers = deviceHeaders('laptop')

    headers.set('authorization', `Bearer ${token}`)

    const { backupCodes } = await opened.auth.api.enableTwoFactor({
      body: { password: 'Pass-word-1' },
      headers,
    })
    const enabled = await stateOf(opened, user.id)

    expect(backupCodes).toHaveLength(10)
    expect(enabled.enabled ?? false).toBe(false)
    expect(enabled.rows.map((row) => row.verified)).toEqual([false])
    // Neither the secret nor a backup code is kept in clear.
    expect(enabled.rows[0]?.backup_codes).not.toContain(backupCodes[0])

    await secondFactorOn(opened.auth, 'laptop', token)

    const on = await stateOf(opened, user.id)

    expect(on.enabled).toBe(true)
    expect(on.rows.map((row) => row.verified)).toEqual([true])
  }, 30_000)

  it("signs a device in with a code of the key on a challenge that has no session, writing its session waiting for the gateway's admission", async () => {
    const opened = await openAuth()

    closers.push(opened.close)

    const { token, user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
    const factor = await secondFactorOn(opened.auth, 'laptop', token)
    const answer = await verified(
      opened,
      'phone',
      '/two-factor/verify-totp',
      await codeOf(factor.secret),
    )
    const body = signedIn.parse(await answer.json())

    expect(answer.status).toBe(200)
    expect(body.user.id).toBe(user.id)
    expect(
      (await sessionStates(opened.local, user.id))
        .filter((row) => row.token === body.token)
        .map(({ device, pending }) => [device, pending]),
    ).toEqual([['phone', true]])
  }, 30_000)

  it('spends a backup code once: a second challenge refuses the same code', async () => {
    const opened = await openAuth()

    closers.push(opened.close)

    const { token, user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
    const factor = await secondFactorOn(opened.auth, 'laptop', token)
    const [code = ''] = factor.backupCodes
    const first = await verified(opened, 'phone', '/two-factor/verify-backup-code', code)

    expect(first.status).toBe(200)
    expect(signedIn.parse(await first.json()).user.id).toBe(
      idSchemas.identity.schema.parse(user.id),
    )

    const again = await verified(opened, 'desk', '/two-factor/verify-backup-code', code)

    expect(again.status).toBe(401)
    expect(z.object({ code: z.string() }).parse(await again.json()).code).toBe(
      'INVALID_BACKUP_CODE',
    )
  }, 30_000)
})
