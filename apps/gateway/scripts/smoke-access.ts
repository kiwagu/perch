/**
 * The access method steps of the smoke test, each on a fresh identity: the clause that refuses
 * tokens issued before `sessions_revoked_at`, and the directory schema applied again with the
 * stand's key.
 */

import { applySchema } from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'

import revokeGrantsStatement from '../src/auth/surql/grants-revoke-all.surql'
import sessionsRevokedStatement from '../src/auth/surql/identity-sessions-revoked.surql'
import type { GatewayRoot } from '../src/composition/root'

import { postCredentials } from './smoke-http'
import { check, step, unwrap } from './smoke-steps'

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
    const answer = unwrap(await root.sessions.authenticate({ access, refresh }))

    if (!answer.renewed) {
      throw new Error('the pair was not renewed')
    }

    return answer.tokens
  })

  await step(
    "the namespace user revokes the identity's grants: the refresh is refused",
    async () => {
      await root.local.db.query(revokeGrantsStatement, { identity })

      const refused = await root.sessions.authenticate(renewed)

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

/**
 * The access method steps: the clause of `sessions_revoked_at`, then the directory schema applied
 * again with `signingKey`, the stand's key.
 */
export async function accessSteps(
  base: string,
  root: GatewayRoot,
  signingKey: string,
): Promise<void> {
  await sessionsRevokedSteps(base, root)
  await reappliedSteps(base, root, signingKey)
}
