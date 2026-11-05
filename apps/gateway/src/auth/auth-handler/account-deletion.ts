import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import type { DepartureError } from '../../tenants/account-departure'
import type { DeletionClaims } from '../account-links'
import type { DeletedAccount } from '../account-teardown'

import type { AuthMountDeps } from './mount'
import { confirmPassword } from './password-confirmation'
import { badRequest, internal, refused } from './requests'
import { type MountCaller, signedIn } from './signed-in'

const requestBody = z.object({ password: z.string() })
const deleteBody = z.object({ token: z.string().min(1).max(4096) })

/** 409 `last-admin`: the account is the only admin of an organisation with other members. */
const lastAdmin = (): Response => refused(409, 'last-admin')

/**
 * Why a deletion stopped when its departure came to spend its link: the link was no longer pending
 * (`link-spent`), or its hour had passed while the departure waited for its turns
 * (`link-expired`). Either stops it with nothing changed.
 */
interface DeletionStop {
  readonly kind: 'link-spent' | 'link-expired'
}

const LINK_SPENT: DeletionStop = { kind: 'link-spent' }
const LINK_EXPIRED: DeletionStop = { kind: 'link-expired' }

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
 * when it expired while the deletion waited for the account). The rest runs in the turns of the
 * account's memberships (`AccountDepartures.leave`), whose check decides: an account that is the
 * only admin of an organisation with other members answers 409 `last-admin` with nothing changed,
 * its link still pending and its sessions alive, so the same link deletes the account once those
 * members are removed. Only once the departure is allowed, and before it writes anything, does
 * the deletion take effect (`spend`): the pending deletion is spent (401 `link-invalid` when it
 * was not pending: used before, replaced by a newer one, or ended by a change of the password or
 * of the email, nothing changed), whom the notice goes to is read while the account exists, every
 * session of the account ends and every socket of it closes with 4001. Then the account leaves
 * its organisations and its own rows are removed, while no invite of it and no creation by it can
 * land, and its sockets close with 4001 once more: a sign-in takes no turn of the account, so a
 * device may sign in while the departure runs and say hello before the rows go, and the second
 * close ends its socket and refuses a hello still under way (the registry's epoch moves). Once the account is gone the notice starts to the email it had, and it answers 200
 * `{ identity }`: the account that was deleted, so the page can tell whether this device was
 * signed in to it.
 */
async function deleted(deps: AuthMountDeps, token: string): Promise<Response> {
  const claims = await judged(deps, token)

  if (claims instanceof Response) {
    return claims
  }

  const { identity } = claims
  const left = await deps.departure.leave(identity, {
    before: () => spend(deps, token, claims),
    after: () => deps.teardown.remove(identity).andThen(() => closed(deps, identity)),
  })

  if (left.isErr()) {
    return refusalOf(left.error)
  }

  deps.mails.accountDeleted(left.value)

  return Response.json({ identity })
}

/**
 * Where a deletion takes effect, in the turns of the account's memberships once its departure is
 * allowed. The link's `token` is judged once more on the gateway's clock, right before it is
 * spent, since the departure may have waited for the turns past the link's hour (`LINK_EXPIRED`,
 * nothing done); then the pending deletion `claims` names is spent (`LINK_SPENT` when it was not
 * pending, or expired by the claim's own reading of the clock, nothing else done), whom the notice
 * goes to is read, every session of the account ends and every socket of it closes with 4001, so
 * no device holds the account while its rows go. Answers whom the notice goes to.
 */
function spend(
  deps: AuthMountDeps,
  token: string,
  claims: DeletionClaims,
): ResultAsync<DeletedAccount, DeletionStop | DataError> {
  const { identity } = claims

  return deps.deletions
    .read(token)
    .andThen((read) =>
      read.kind === 'deletion'
        ? deps.deletions.claim(claims)
        : errAsync<boolean, DeletionStop | DataError>(
            read.kind === 'expired' ? LINK_EXPIRED : LINK_SPENT,
          ),
    )
    .andThen((claimed) =>
      claimed
        ? deps.teardown.addressee(identity)
        : errAsync<DeletedAccount, DeletionStop | DataError>(LINK_SPENT),
    )
    .andThen((addressee) => deps.sessions.revokeAll(identity).map(() => addressee))
    .andThen((addressee) => closed(deps, identity).map(() => addressee))
}

/**
 * Closes every socket of `identity` with 4001 and moves the registry's epoch against it, so a
 * hello that read the epoch before is refused at its registration. The registry's closes never
 * reject.
 */
function closed(deps: AuthMountDeps, identity: IdentityId): ResultAsync<void, never> {
  return ResultAsync.fromSafePromise(deps.connections.close(identity, undefined, CLOSE.revoked))
}

/**
 * The answer to a deletion that did not happen: 409 `last-admin` for a departure the check
 * refused, 401 `link-invalid` for a link no longer pending, 401 `link-expired` for one whose hour
 * passed while its departure waited, 500 `internal` for a failure.
 */
function refusalOf(error: DepartureError | DeletionStop): Response {
  if (!('kind' in error)) {
    return internal()
  }

  return match(error.kind)
    .with('refused', () => lastAdmin())
    .with('link-spent', () => refused(401, 'link-invalid'))
    .with('link-expired', () => refused(401, 'link-expired'))
    .exhaustive()
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
