/**
 * The access method steps of the smoke test, each on a fresh identity: the clause that refuses
 * tokens issued before `sessions_revoked_at`, and the directory schema applied again with the
 * stand's key; then the limits of the credential routes, each from a device of its own, and the
 * renewal limit of a device.
 */

import { applySchema } from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'
import { CLOSE, PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { RenewalGate } from '../../src/auth/identity-sessions'
import revokeGrantsStatement from '../../src/auth/surql/grants-revoke-all.surql'
import sessionsRevokedStatement from '../../src/auth/surql/identity-sessions-revoked.surql'
import type { GatewayRoot } from '../../src/composition/root'
import { TRY_AGAIN_LATER } from '../../src/sync/sync-connection'

import { SmokeDevice } from './device'
import { type Answer, type Credentials, call, postCredentials } from './http'
import { check, type Opened, step, unwrap } from './steps'

/** The renewals these steps make themselves go through: the limits are not under test there. */
const anyRenewal: RenewalGate = () => true

/**
 * The clause of the access method, on a fresh identity: its fresh token is accepted, the same
 * token issued before `sessions_revoked_at` is refused, a refresh is not (its exchange carries
 * no token), and the gateway's namespace user revokes the identity's grants, which refuses the
 * refresh.
 */
async function sessionsRevokedSteps(base: string, root: GatewayRoot): Promise<void> {
  const signedUp = await postCredentials(base, '/auth/sign-up', {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: crypto.randomUUID(),
    device: { id: 'smoke-device', label: 'Smoke' },
  })
  const { access, refresh } = signedUp.tokens
  const identity = signedUp.identity.id

  // The same token through the same calls: only the mark explains the refusal that follows.
  await step('a fresh token is accepted before sessions_revoked_at', async () => {
    const accepted = unwrap(await root.sessions.authenticate({ access }))

    check(accepted.renewed === false, 'the token was renewed')
  })

  await step('sessions_revoked_at set by the namespace user', async () => {
    await root.local.db.query(sessionsRevokedStatement, {
      identity,
      at: new Date(Date.now() + 5_000),
    })
  })

  await step('a token issued before sessions_revoked_at is refused', async () => {
    const refused = await root.sessions.authenticate({ access })

    check(refused.isErr(), 'the token was accepted')
  })

  const renewed = await step('a refresh is not blocked by the clause', async () => {
    const answer = unwrap(await root.sessions.authenticate({ access, refresh }, anyRenewal))

    if (!answer.renewed) {
      throw new Error('the pair was not renewed')
    }

    return answer.tokens
  })

  await step(
    "the namespace user revokes the identity's grants: the refresh is refused",
    async () => {
      await root.local.db.query(revokeGrantsStatement, { identity })

      const refused = await root.sessions.authenticate(renewed, anyRenewal)

      check(refused.isErr(), 'the refresh was accepted')
    },
  )
}

/**
 * The directory schema applied again with `signingKey`, the key the stand's gateway signs with,
 * on a fresh identity from its own device: the access token it was issued before still signs in,
 * without a renewal.
 */
async function reappliedSteps(base: string, root: GatewayRoot, signingKey: string): Promise<void> {
  await step(
    "the directory schema applied again with the stand's key: an issued token still signs in",
    async () => {
      const signedUp = await postCredentials(base, '/auth/sign-up', {
        email: `smoke-${crypto.randomUUID()}@example.test`,
        password: crypto.randomUUID(),
        device: { id: 'smoke-device-reapplied', label: 'Smoke' },
      })

      unwrap(await applySchema(root.local, readSchema('directory'), signingKey))

      const accepted = unwrap(await root.sessions.authenticate({ access: signedUp.tokens.access }))

      check(accepted.renewed === false, 'the token was renewed')
      check(accepted.identity.id === signedUp.identity.id, `signed in as ${accepted.identity.id}`)
    },
  )
}

/** The answer of a limit that refused a request. */
const rateLimited = z.object({ code: z.literal('rate-limited') })

/** Signs in `count` times one after the other from `device`, each time with `credentials()`. */
async function signIns(
  base: string,
  device: Credentials['device'],
  count: number,
  credentials: () => Omit<Credentials, 'device'>,
): Promise<Answer[]> {
  const answers: Answer[] = []

  for (let attempt = 0; attempt < count; attempt += 1) {
    const body = { ...credentials(), device }

    answers.push(await call(base, 'POST', '/auth/sign-in', undefined, body, device.id))
  }

  return answers
}

/** Every answer but the last has `status`; the last is a 429 `rate-limited` with `Retry-After`. */
function checkLimited(answers: readonly Answer[], status: number): void {
  const before = answers.slice(0, -1).map((answer) => answer.status)
  const last = answers.at(-1)
  const retryAfter = Number(last?.headers.get('Retry-After'))

  check(
    before.every((answered) => answered === status),
    `answered ${before.join(' ')} before the limit`,
  )
  check(last?.status === 429, `the last answered ${last?.status}`)
  check(rateLimited.safeParse(last?.body).success, `the last said ${JSON.stringify(last?.body)}`)
  check(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After ${retryAfter}`)
}

/**
 * The limits of the credential routes, each from a device, so a simulated client address, of its
 * own: 20 credential checks per address within 10 s (sign-ins of unknown emails, which cost the
 * database no password check), and 10 failed sign-ins per email.
 */
async function limitSteps(base: string): Promise<void> {
  await step(
    '21 sign-ins of unknown emails from one address within 10 s: the 21st answers 429 with Retry-After',
    async () => {
      const device = { id: 'smoke-device-unknown-emails', label: 'Smoke' }
      const answers = await signIns(base, device, 21, () => ({
        email: `smoke-${crypto.randomUUID()}@example.test`,
        password: crypto.randomUUID(),
      }))

      checkLimited(answers, 401)
    },
  )

  await step('11 wrong passwords for one email: the 11th answers 429', async () => {
    const device = { id: 'smoke-device-wrong-passwords', label: 'Smoke' }
    const { identity } = await postCredentials(base, '/auth/sign-up', {
      email: `smoke-${crypto.randomUUID()}@example.test`,
      password: crypto.randomUUID(),
      device,
    })
    const answers = await signIns(base, device, 11, () => ({
      email: identity.email,
      password: crypto.randomUUID(),
    }))

    checkLimited(answers, 401)
  })
}

/** A made-up refresh key: the form of the database's keys, a grant and a secret nobody holds. */
function madeUpRefresh(): string {
  const hex = () => crypto.randomUUID().replaceAll('-', '')

  return `surreal-refresh-${hex().slice(0, 12)}-${hex()}`
}

/**
 * The renewal limit of a device, 10 in 15 minutes: hellos of one device with a dead access token
 * and a made-up refresh key, each a cheap refused lookup until the limit refuses the renewal
 * before the database is asked. The smoke's own gateway counts them, so nothing carries over to
 * the stand's gateway.
 */
async function renewalSteps(base: string, opened: Opened): Promise<void> {
  await step(
    `11 hellos of one device with a dead access token and a made-up refresh key within 15 minutes: the first 10 close ${CLOSE.unauthorized}, the 11th ${TRY_AGAIN_LATER}`,
    async () => {
      const codes: number[] = []

      for (let attempt = 0; attempt < 11; attempt += 1) {
        const device = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

        opened.devices.push(device)
        device.send({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          access: 'not-a-token',
          refresh: madeUpRefresh(),
          device: 'smoke-device-renewals',
        })
        codes.push((await device.closed).code)
      }

      const expected = [...Array.from({ length: 10 }, () => CLOSE.unauthorized), TRY_AGAIN_LATER]

      check(codes.join(' ') === expected.join(' '), `closed with ${codes.join(' ')}`)
    },
  )
}

/**
 * The access method steps: the clause of `sessions_revoked_at`, then the directory schema applied
 * again with `signingKey`, the stand's key; then the limits of the credential routes and of a
 * device's renewals.
 */
export async function accessSteps(
  base: string,
  root: GatewayRoot,
  signingKey: string,
  opened: Opened,
): Promise<void> {
  await sessionsRevokedSteps(base, root)
  await reappliedSteps(base, root, signingKey)
  await limitSteps(base)
  await renewalSteps(base, opened)
}
