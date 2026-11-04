import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import type { DeletionClaims } from '../account-links'

import type { AuthMountDeps } from './mount'
import { confirmPassword } from './password-confirmation'
import { badRequest, internal, refused } from './requests'
import { type MountCaller, signedIn } from './signed-in'

const requestBody = z.object({ password: z.string() })
const deleteBody = z.object({ token: z.string().min(1).max(4096) })

/** 409 `last-admin`: the account is the only admin of an organisation with other members. */
const lastAdmin = (): Response => refused(409, 'last-admin')

/**
 * Asks to delete the caller's account (`{ password }`, with the device's token and
 * `X-Perch-Device`). After the caller is read (`signedIn`), it takes one of the client address's
 * credential checks (429); a body it cannot read answers 400 `bad-request`. Then one of the
 * address's mails and one of the account's three requests in a quarter of an hour are taken
 * (`RequestLimits.deletionMail`, 429). Everything after runs in the account's turn: the password
 * is confirmed (`confirmPassword`: 401 when the session ended meanwhile, 429, 400
 * `invalid-credentials`); an account that is the only admin of an organisation with other members
 * answers 409 `last-admin` and gets no mail; any other keeps its deletion as the pending one,
 * replacing an earlier one, and the mail to the account's email starts, its link carrying the
 * deletion's token: 202 with no body. The account stays as it is until the link is used. It has
 * no floor: the request concerns the caller's own account, and its answer tells nothing of others.
 */
export function requestAccountDeletion(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  return signedIn(deps, request, (caller) => requested(deps, request, from, caller))
}

async function requested(
  deps: AuthMountDeps,
  request: Request,
  from: string,
  caller: MountCaller,
): Promise<Response> {
  const checks = deps.limits.credentials(from)

  if (!checks.allowed) {
    return tooMany(checks)
  }

  const body = requestBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const mails = deps.limits.deletionMail(from, caller.identity)

  if (!mails.allowed) {
    return tooMany(mails)
  }

  return deps.accounts.run(caller.identity, async () => {
    const confirmed = await confirmPassword(deps, caller, body.data.password)

    if (confirmed instanceof Response) {
      return confirmed
    }

    const asked = await askDeletion(deps, caller.identity)

    if (asked.isErr()) {
      return internal()
    }

    return asked.value === 'blocked' ? lastAdmin() : new Response(null, { status: 202 })
  })
}

/**
 * In the account's turn, its password confirmed: `blocked` while it is the only admin of an
 * organisation with other members, nothing kept or mailed; otherwise its deletion is kept,
 * replacing an earlier one, and the mail with the link starts (`asked`).
 */
function askDeletion(
  deps: AuthMountDeps,
  identity: IdentityId,
): ResultAsync<'asked' | 'blocked', DataError> {
  return deps.departure.blocked(identity).andThen((blocked) =>
    blocked
      ? okAsync('blocked' as const)
      : deps.deletions.ask(identity).map((token) => {
          deps.mails.deleteAccount(identity, token)

          return 'asked' as const
        }),
  )
}

/**
 * Deletes an account with the token of its deletion link (`{ token }`), on the press of the
 * deletion page's button; the request's own session, if any, plays no part. The client address's
 * attempts are taken first (`RequestLimits.accountDeletion`, 429 once spent), then a body it
 * cannot read answers 400 `bad-request`, a token the gateway did not sign as a deletion 401
 * `link-invalid`, one asked an hour ago or more 401 `link-expired`. The rest runs in the account's
 * turn (`deleted`). Any failure of the gateway answers 500 `internal`.
 */
export async function deleteAccount(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const attempt = deps.limits.accountDeletion(from)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  const body = deleteBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const { token } = body.data
  const read = await judged(deps, token)

  return read instanceof Response
    ? read
    : deps.accounts.run(read.identity, () => deleted(deps, token))
}

/**
 * In the account's turn. The link is judged again on the clock as it is then (401 `link-expired`
 * when it expired while the deletion waited for the account). An account that is the only admin
 * of an organisation with other members answers 409 `last-admin` with nothing changed and its link
 * still pending, so the same link deletes the account once those members are removed. The pending
 * deletion the token names is spent then (401 `link-invalid` when it was not pending: used before,
 * replaced by a newer one, or ended by a change of the password or of the email). Whom the notice
 * goes to is read while the account exists; every session of the account ends and every socket of
 * it closes with 4001 before any row goes; the account leaves its organisations, and its own rows
 * are removed while no invite of it can land (`Organisations.leaveAll`, its continuation). An
 * account that became the only admin of an organisation with other members meanwhile answers 409
 * `last-admin` there, its sessions ended already. Once the account is gone the notice starts to
 * the email it had, and it answers 200 `{ identity }`: the account that was deleted, so the page
 * can tell whether this device was signed in to it.
 */
async function deleted(deps: AuthMountDeps, token: string): Promise<Response> {
  const claims = await judged(deps, token)

  if (claims instanceof Response) {
    return claims
  }

  const { identity } = claims
  const blocked = await deps.departure.blocked(identity)

  if (blocked.isErr()) {
    return internal()
  }

  if (blocked.value) {
    return lastAdmin()
  }

  const claimed = await deps.deletions.claim(claims)

  if (claimed.isErr()) {
    return internal()
  }

  if (!claimed.value) {
    return refused(401, 'link-invalid')
  }

  const addressee = await deps.teardown.addressee(identity)

  if (addressee.isErr()) {
    return internal()
  }

  const ended = await deps.sessions.revokeAll(identity)

  if (ended.isErr()) {
    return internal()
  }

  await deps.connections.close(identity, undefined, CLOSE.revoked)

  const left = await deps.departure.leave(identity, () => deps.teardown.remove(identity))

  if (left.isErr()) {
    return 'kind' in left.error ? lastAdmin() : internal()
  }

  deps.mails.accountDeleted(addressee.value)

  return Response.json({ identity })
}

/**
 * What the deletion link's `token` reads as on the gateway's clock now: the deletion it names, or
 * its refusal, 401 `link-invalid` for a token the gateway did not sign as a deletion and 401
 * `link-expired` for one past its hour.
 */
async function judged(deps: AuthMountDeps, token: string): Promise<Response | DeletionClaims> {
  const read = await deps.deletions.read(token)

  if (read.isErr() || read.value.kind === 'invalid') {
    return refused(401, 'link-invalid')
  }

  return read.value.kind === 'expired' ? refused(401, 'link-expired') : read.value.claims
}
