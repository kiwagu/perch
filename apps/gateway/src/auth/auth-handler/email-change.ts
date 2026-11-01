import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'

import { until } from './floor'
import type { AuthMountDeps } from './mount'
import { badRequest, internal, refused } from './requests'
import { type MountCaller, signedIn } from './signed-in'

/**
 * How soon, at the earliest, a change of the email answers after it began: above the work of
 * either branch (keeping the change, signing its link and starting its mail for a free email; a
 * look-up alone for a taken one), the password's check before them included, so neither the
 * answer nor its time tells whether the new email has an account, in this process and while that
 * work stays under it.
 */
export const CHANGE_EMAIL_FLOOR_MS = 800

const changeBody = z.object({ email: z.string().min(1).max(320), password: z.string() })
const emailShape = z.email()
const confirmBody = z.object({ token: z.string().min(1).max(4096) })

/**
 * Asks to change the caller's email (`{ email, password }`, with the device's token and
 * `X-Perch-Device`). After the caller is read (`signedIn`), it takes one of the client address's
 * credential checks (429); a body it cannot read answers 400 `bad-request`, a new email that is
 * not an email 400 `email-invalid`. Then one of the address's mails and one of the account's
 * three changes in a quarter of an hour are taken (`RequestLimits.emailChangeMail`, 429), and the
 * password must find a place among the account's failed sign-ins (429), a wrong one keeping it:
 * 400 `invalid-credentials`. With the right password, in the account's turn, its earlier pending
 * change ends and, when no account has the new email (the caller's own email counts as taken), a
 * new change is kept and the mail to the new email starts, its link carrying the change's token;
 * a taken email gets no mail. Both answer `202` with no body, no sooner than
 * `CHANGE_EMAIL_FLOOR_MS` after the request began. The account keeps its email until the link is
 * opened.
 */
export function changeEmail(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const started = deps.clock.now()

  return signedIn(deps, request, (caller) => asked(deps, request, from, caller, started))
}

async function asked(
  deps: AuthMountDeps,
  request: Request,
  from: string,
  caller: MountCaller,
  started: number,
): Promise<Response> {
  const checks = deps.limits.credentials(from)

  if (!checks.allowed) {
    return tooMany(checks)
  }

  const body = changeBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const newEmail = body.data.email.trim().toLowerCase()

  if (!emailShape.safeParse(newEmail).success) {
    return refused(400, 'email-invalid')
  }

  const mails = deps.limits.emailChangeMail(from, caller.identity)

  if (!mails.allowed) {
    return tooMany(mails)
  }

  const email = caller.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  let outcome: SignInOutcome = 'unjudged'

  try {
    const matches = await deps.passwords.matches(caller.token, body.data.password)

    if (matches.isErr()) {
      return internal()
    }

    outcome = matches.value ? 'succeeded' : 'failed'
  } finally {
    attempt.settle(outcome)
  }

  if (outcome === 'failed') {
    return refused(400, 'invalid-credentials')
  }

  const kept = await deps.accounts.run(caller.identity, () =>
    keepChange(deps, caller.identity, email, newEmail),
  )

  if (kept.isErr()) {
    return internal()
  }

  await until(deps.clock, started + CHANGE_EMAIL_FLOOR_MS)

  return new Response(null, { status: 202 })
}

/**
 * In the account's turn: ends its pending change of email, then, when no account has `newEmail`
 * (its own `email` counts as taken), keeps a new change from `email` to it and starts the mail to
 * it with the change's link. A taken email ends the earlier change all the same, and gets no mail.
 */
function keepChange(
  deps: AuthMountDeps,
  identity: IdentityId,
  email: string,
  newEmail: string,
): ResultAsync<void, DataError> {
  const taken: ResultAsync<boolean, DataError> =
    newEmail === email
      ? okAsync(true)
      : deps.sessions.identityOf(newEmail).map((holder) => holder !== undefined)

  return taken
    .andThen((isTaken) => deps.emailChanges.cancel(identity).map(() => isTaken))
    .andThen((isTaken) =>
      isTaken
        ? okAsync(undefined)
        : deps.emailChanges
            .ask(identity, email, newEmail)
            .map((token) => deps.mails.confirmEmail(identity, newEmail, token)),
    )
}

/**
 * Changes an account's email with the token of a confirmation link (`{ token }`); the request's
 * own session, if any, plays no part, and nothing is signed in. The client address's attempts are
 * taken first (`RequestLimits.emailConfirmation`, 429 once spent). A token the gateway did not
 * sign as a confirmation answers 401 `link-invalid`, one asked a day ago or more 401
 * `link-expired`. In the turns of the account and of the new email (so no sign-up of the new
 * email runs meanwhile), the pending change the token names is spent, and the account's email
 * becomes the new one: 401 `link-invalid` when that change was not pending (used before, replaced
 * by a newer one, or ended by a change of the password), when the account's email is no longer
 * the one the change was asked from, or when the new email has got an account meanwhile. Once it
 * changed, the notice of a changed email starts to the old email, and it answers 200
 * `{ identity, email }`: the account whose email changed, and its new email, so the page can tell
 * whether this device is signed in to it.
 */
export async function confirmEmail(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const attempt = deps.limits.emailConfirmation(from)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  const body = confirmBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const read = await deps.emailChanges.read(body.data.token)

  if (read.isErr() || read.value.kind === 'invalid') {
    return refused(401, 'link-invalid')
  }

  if (read.value.kind === 'expired') {
    return refused(401, 'link-expired')
  }

  const { claims } = read.value

  return deps.accounts.run(claims.identity, () =>
    deps.accounts.run(claims.newEmail, async () => {
      const claimed = await deps.emailChanges.claim(claims)

      if (claimed.isErr()) {
        return internal()
      }

      if (!claimed.value) {
        return refused(401, 'link-invalid')
      }

      const holder = await deps.sessions.identityOf(claims.newEmail)

      if (holder.isErr()) {
        return internal()
      }

      if (holder.value !== undefined) {
        return refused(401, 'link-invalid')
      }

      const moved = await deps.emailChanges.move(claims.identity, claims.email, claims.newEmail)

      if (moved.isErr()) {
        return internal()
      }

      if (!moved.value) {
        return refused(401, 'link-invalid')
      }

      deps.mails.emailChanged(claims.identity, claims.email)

      return Response.json({ identity: claims.identity, email: claims.newEmail })
    }),
  )
}
