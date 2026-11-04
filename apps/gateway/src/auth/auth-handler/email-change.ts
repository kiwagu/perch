import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { bearerRefused } from '../bearer-caller'

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

const changeBody = z.object({ email: z.string(), password: z.string() })
/** A new email as the change takes it: an email of at most 320 characters, trimmed. */
const newEmailShape = z.email().max(320)
const confirmBody = z.object({ token: z.string().min(1).max(4096) })

/**
 * Asks to change the caller's email (`{ email, password }`, with the device's token and
 * `X-Perch-Device`). After the caller is read (`signedIn`), it takes one of the client address's
 * credential checks (429); a body it cannot read answers 400 `bad-request`, a new email that is
 * not an email (empty, longer than 320 characters, or of any other shape) 400 `email-invalid`.
 * Then one of the address's mails and one of the account's three changes in a quarter of an hour
 * are taken (`RequestLimits.emailChangeMail`, 429). Everything after runs in the account's turn,
 * so no reset or change of its password runs in between: the caller's session is read again (401
 * `unauthorized` when it ended meanwhile) with the account's email as it is now, the password must
 * find a place among that email's failed sign-ins (429) and match the credential row, a wrong one
 * keeping its place: 400 `invalid-credentials`. With the right password the earlier pending change
 * ends and, when no account has the new email (the account's own email counts as taken), a new
 * change is kept and the mail to the new email starts, its link carrying the change's token; a
 * taken email gets no mail. Both answer `202` with no body, no sooner than `CHANGE_EMAIL_FLOOR_MS`
 * after the request began. The account keeps its email until the link is opened.
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

  const newEmail = newEmailShape.safeParse(body.data.email.trim().toLowerCase())

  if (!newEmail.success) {
    return refused(400, 'email-invalid')
  }

  const mails = deps.limits.emailChangeMail(from, caller.identity)

  if (!mails.allowed) {
    return tooMany(mails)
  }

  const answer = await deps.accounts.run(caller.identity, () =>
    authenticated(deps, caller, body.data.password, newEmail.data),
  )

  if (answer !== 'kept') {
    return answer
  }

  await until(deps.clock, started + CHANGE_EMAIL_FLOOR_MS)

  return new Response(null, { status: 202 })
}

/**
 * In the account's turn: the caller's session read again, with the account's email as it is now,
 * then its password checked against its failed sign-ins and the credential row, then the change
 * kept (`keepChange`): `kept`, or the answer that refuses it.
 */
async function authenticated(
  deps: AuthMountDeps,
  caller: MountCaller,
  password: string,
  newEmail: string,
): Promise<Response | 'kept'> {
  const read = await deps.sessions.read(caller.token)

  if (read.kind === 'failed') {
    return internal()
  }

  if (
    read.kind === 'none' ||
    read.caller.identity !== caller.identity ||
    read.caller.device !== caller.device
  ) {
    return bearerRefused()
  }

  const email = read.caller.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  let outcome: SignInOutcome = 'unjudged'

  try {
    const matches = await deps.passwords.matches(caller.identity, password)

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

  const kept = await keepChange(deps, caller.identity, email, newEmail)

  return kept.isOk() ? 'kept' : internal()
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
 * email runs meanwhile), the token is judged again on the clock as it is then (401 `link-expired`
 * when it expired while the confirmation waited), the pending change the token names is spent,
 * and the account's email becomes the new one: 401 `link-invalid` when that change was not
 * pending (used before, replaced
 * by a newer one, or ended by a change of the password), when the account's email is no longer
 * the one the change was asked from, or when the new email has got an account meanwhile. Once it
 * changed, the notice of a changed email starts to the old email, the profile's email follows in
 * the identity's private region (`ProfileEmails.follow`, after the answer), and it answers 200
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

  const { token } = body.data
  const read = await deps.emailChanges.read(token)

  if (read.isErr() || read.value.kind === 'invalid') {
    return refused(401, 'link-invalid')
  }

  if (read.value.kind === 'expired') {
    return refused(401, 'link-expired')
  }

  const { claims } = read.value

  return deps.accounts.run(claims.identity, () =>
    deps.accounts.run(claims.newEmail, async () => {
      // The link is judged again at its spending, on the clock as it is then: it may have expired
      // while the confirmation waited for the account.
      const again = await deps.emailChanges.read(token)

      if (again.isErr() || again.value.kind === 'expired') {
        return refused(401, 'link-expired')
      }

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
      // Every device shows the profile's email: it follows the account's, in the account's next
      // turn, once this one ended, so the answer waits for nothing the account's profile decides,
      // and a later change of the email follows after it. A gateway that stops before it ran
      // brings the profile in step at the account's next hello (`ProfileEmails.reconcile`).
      deps.profiles.queue(claims.identity)

      return Response.json({ identity: claims.identity, email: claims.newEmail })
    }),
  )
}
