import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import type { KeyedTurns } from '../../keyed-turns'
import type { RequestLimits } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import type { ConnectionRegistry } from '../../sync/connections'
import type { DepartureError, DepartureSteps } from '../../tenants/account-departure'
import type { AccountDeletions, EmailChanges, ResetLinks } from '../account-links'
import type { AccountMails } from '../account-mails'
import type { AccountPasswords } from '../account-passwords'
import type { AccountTeardown } from '../account-teardown'
import type { AuthInstance } from '../auth-instance'
import type { AuthSessions } from '../auth-sessions'
import type { ProfileEmails } from '../profile-emails'

import { deleteAccount, requestAccountDeletion } from './account-deletion'
import { changeEmail, confirmEmail } from './email-change'
import { changePassword } from './password-change'
import { requestPasswordReset, resetPassword } from './password-reset'
import { AUTH_PATHS } from './requests'
import { SIGN_IN_PATH, signIn } from './sign-in'
import { signUp } from './sign-up'
import { resend, verify } from './verification'

const SIGN_UP_PATH = '/auth/sign-up/email'
const VERIFY_PATH = '/auth/verify-email'
const RESEND_PATH = '/auth/send-verification-email'
const REQUEST_RESET_PATH = '/auth/request-password-reset'
const RESET_PATH = '/auth/reset-password'
const CHANGE_PASSWORD_PATH = '/auth/change-password'
const CHANGE_EMAIL_PATH = '/auth/change-email'
const CONFIRM_EMAIL_PATH = '/auth/confirm-email'
const REQUEST_DELETION_PATH = '/auth/request-account-deletion'
const DELETE_ACCOUNT_PATH = '/auth/delete-account'

/**
 * The organisations of an account whose deletion is asked: whether it is the only admin of a
 * ready organisation with other members (`blocked`, a read that decides nothing for a deletion),
 * and its departure from every one of them (`Organisations.leaveAll`), which decides that in the
 * turns of its memberships and runs `steps` there: `before` once it is allowed, ahead of every
 * write, and `after` once the account left, while no invite of it can land.
 */
export interface AccountDepartures {
  blocked(identity: IdentityId): ResultAsync<boolean, DataError>
  leave<T, Stop>(
    identity: IdentityId,
    steps: DepartureSteps<T, Stop>,
  ): ResultAsync<T, DepartureError | Stop>
}

/**
 * What the mount answers with: Better Auth, the gateway's sessions, passwords, account links,
 * mails and limits, the sockets, a clock, the accounts' turns.
 */
export interface AuthMountDeps {
  readonly auth: Pick<AuthInstance, 'handler'>
  readonly sessions: Pick<
    AuthSessions,
    'signedIn' | 'identityOf' | 'verificationOf' | 'read' | 'signOut' | 'revokeAll' | 'admit'
  >
  /** The reset mail, the reset, the change and the check of a password, an email's credential. */
  readonly passwords: Pick<
    AccountPasswords,
    'requestReset' | 'hash' | 'reset' | 'change' | 'matches' | 'credentialOf'
  >
  /** The reset links of accounts, which Better Auth keeps. */
  readonly resets: Pick<ResetLinks, 'read'>
  /** The pending changes of accounts' emails, and the change itself. */
  readonly emailChanges: Pick<EmailChanges, 'ask' | 'cancel' | 'read' | 'claim' | 'move'>
  /** The pending deletions of accounts, and their links. */
  readonly deletions: Pick<AccountDeletions, 'ask' | 'read' | 'claim'>
  /** The organisations a deleted account leaves. */
  readonly departure: AccountDepartures
  /** Whom the notice of a deleted account goes to, and the removal of the account's own rows. */
  readonly teardown: Pick<AccountTeardown, 'addressee' | 'remove'>
  /**
   * The confirmation of a new email, the deletion mail, and the notices of a changed password, a
   * changed email and a deleted account.
   */
  readonly mails: Pick<
    AccountMails,
    'confirmEmail' | 'passwordChanged' | 'emailChanged' | 'deleteAccount' | 'accountDeleted'
  >
  /** The profile's email, which follows the account's into its private region. */
  readonly profiles: Pick<ProfileEmails, 'queue'>
  readonly limits: Pick<
    RequestLimits,
    | 'credentials'
    | 'signInAttempt'
    | 'verificationMail'
    | 'resetMail'
    | 'emailChangeMail'
    | 'deletionMail'
    | 'passwordReset'
    | 'emailConfirmation'
    | 'accountDeletion'
  >
  readonly connections: Pick<ConnectionRegistry, 'close'>
  /** The gateway's clock. */
  readonly clock: Clock
  /**
   * One account's work, one turn at a time in this process: its sign-ups, verifications and reset
   * requests by its email in lower case; its reset, its changes of password and of email by its
   * identity's key; a confirmation by both, the identity first, then the new email, so no sign-up
   * of the new email runs meanwhile; a request to delete the account and a deletion by its
   * identity's key. A sign-in takes no turn (`signIn`). No work takes an identity's turn inside an
   * email's, so the turns never wait on each other in a circle.
   */
  readonly accounts: KeyedTurns<string>
}

/**
 * The paths the mount answers, each by `POST` only; every other path under `/auth/` answers 404
 * here. Handing everything over would expose each endpoint Better Auth and its plugins add, such
 * as the list of an account's sessions with every session's token, an ending of a session that
 * leaves its device's sockets open, or the admin plugin's ban and role of an account; a later
 * feature allows its endpoint here on purpose. The
 * verification is taken by POST with its token in the body and handed to Better Auth's GET, so a
 * token never sits in a URL the gateway serves. The reset, the changes of password and email and
 * the confirmation reach no Better Auth route over HTTP: the mount calls Better Auth on the
 * server where it needs it. Better Auth's own deletion of a user is not among them: the gateway
 * deletes an account itself, by a mailed link.
 */
const SERVED_PATHS: ReadonlyMap<
  string,
  (deps: AuthMountDeps, request: Request, from: string) => Promise<Response>
> = new Map([
  [SIGN_UP_PATH, credentialChecked(signUp)],
  [SIGN_IN_PATH, credentialChecked((deps, request) => signIn(deps, request))],
  [VERIFY_PATH, credentialChecked((deps, request) => verify(deps, request))],
  [RESEND_PATH, resend],
  [REQUEST_RESET_PATH, requestPasswordReset],
  [RESET_PATH, resetPassword],
  [CHANGE_PASSWORD_PATH, changePassword],
  [CHANGE_EMAIL_PATH, changeEmail],
  [CONFIRM_EMAIL_PATH, confirmEmail],
  [REQUEST_DELETION_PATH, requestAccountDeletion],
  [DELETE_ACCOUNT_PATH, deleteAccount],
])

/** `answer` once the client address took one of its credential checks (429 when they are spent). */
function credentialChecked(
  answer: (deps: AuthMountDeps, request: Request, from: string) => Promise<Response>,
) {
  return (deps: AuthMountDeps, request: Request, from: string): Promise<Response> => {
    const address = deps.limits.credentials(from)

    return address.allowed ? answer(deps, request, from) : Promise.resolve(tooMany(address))
  }
}

/**
 * Better Auth's sign-up, sign-in, verification and resend behind the gateway's own limits, and the
 * gateway's recovery and change of a password, change of an email and deletion of an account. Of
 * the paths under `/auth/`, only the first four are handed to Better Auth's handler, at the path
 * Better Auth serves them under (the front's prefix put back); the other seven are answered here,
 * calling Better Auth on the server where they need it. Another method on any of them answers 405
 * with `Allow: POST`, and every other path under `/auth/` 404 `not-found`, Better Auth not asked.
 * A path outside `/auth/` is not answered here (`undefined`). The device routes come before this
 * one in the server, so the sign-outs they serve under `/auth/` are theirs.
 *
 * - `POST /auth/sign-up/email` and `POST /auth/sign-in/email` each first take one of their client
 *   address's credential checks (`RequestLimits.credentials`, `from` being the address the server
 *   resolved). A sign-up then takes one of the address's verification mails, whatever its email,
 *   and runs one email at a time (`signUp`): 202 with no body for every sign-up Better Auth
 *   accepts, a new, a taken or a concurrently taken email alike, no sooner than
 *   `SIGN_UP_FLOOR_MS` after the request began; 400 `bad-request` for a body that names no email
 *   or no password; 400 `weak-password` at once for a password that breaks the rules of a new
 *   password, before its email's turn and Better Auth; it signs nothing in and closes no socket. A sign-in answers 200 with the raw session token and
 *   the account, its id, email, name and whether its email is verified, built from Better Auth's
 *   answer by that allowlist, without its cookies (`signIn`). It must first find a place among
 *   its email's failed sign-ins and those still under way (`RequestLimits.signInAttempt`, the
 *   email in lower case), held until Better Auth answers: 401 (wrong credentials) keeps it as a
 *   failure, 200 and 403 (the password was right, the email is not verified) clear the email's,
 *   and any other answer, or a handler that threw, gives it back. A sign-in whose body is not
 *   JSON naming an email answers 400 `bad-request`; one that is reaches Better Auth as that JSON,
 *   whatever content type it came with, so the email Better Auth checks is the one counted. A
 *   sign-in Better Auth accepts closes the identity's sync sockets on the device the request
 *   names with 1000 (`connections`) before its answer is returned: the new session ended the
 *   device's earlier one.
 * - `POST /auth/verify-email` `{ token }`, with the device's headers: takes one of the address's
 *   credential checks too, then exchanges the link's token (`verify`): 200 `{ token, user: { id,
 *   email, name, locale } }` the first time, which signs the device in, 200 `{ token: null }` for
 *   an account verified before, 401 `link-invalid` or `link-expired` for a link that verifies
 *   nothing (a link verifies only the account its mail went to, so one whose email another
 *   account holds now is dead), 400 `bad-request` without a device or a token, 500 `internal`
 *   when the gateway failed.
 * - `POST /auth/send-verification-email` `{ email }`: takes one of the address's verification
 *   mails and one of the email's resends (`RequestLimits.verificationMail`), then asks Better Auth
 *   to send the mail again (`resend`): 202 with no body, alike for any email; 400 `bad-request`
 *   for a body that names no email.
 * - `POST /auth/request-password-reset` `{ email }` (`requestPasswordReset`): 202 with no body,
 *   alike for any email, no sooner than `RESET_REQUEST_FLOOR_MS` after it began.
 * - `POST /auth/reset-password` `{ token, password }`, with the device's token when it has one
 *   (`resetPassword`): 200 `{ signedOut }`, every session of the account ended and its sockets
 *   closed with 4002, `signedOut` saying whether the request's own session was one of them; 400
 *   `password-rejected`, 401 `link-invalid` or `link-expired`.
 * - `POST /auth/change-password` `{ currentPassword, password }`, with the device's token
 *   (`changePassword`): 204, every other session of the account ended and its sockets closed
 *   with 4002; 400 `invalid-credentials` or `password-rejected`.
 * - `POST /auth/change-email` `{ email, password }`, with the device's token (`changeEmail`):
 *   202 with no body, alike for a taken and a free email, no sooner than
 *   `CHANGE_EMAIL_FLOOR_MS` after it began; 400 `invalid-credentials` or `email-invalid`.
 * - `POST /auth/confirm-email` `{ token }` (`confirmEmail`): 200 `{ identity, email }` once the
 *   account's email is the new one; 401 `link-invalid` or `link-expired`.
 * - `POST /auth/request-account-deletion` `{ password }`, with the device's token
 *   (`requestAccountDeletion`): 202 with no body once the deletion mail is on its way to the
 *   account's email; 400 `invalid-credentials`, 409 `last-admin`.
 * - `POST /auth/delete-account` `{ token }` (`deleteAccount`): 200 `{ identity }` once the account
 *   is gone, every session of it ended and its sockets closed with 4001 first, and its sockets
 *   closed with 4001 once more after its rows went; 401 `link-invalid` or `link-expired`, 409
 *   `last-admin`.
 *
 * A limit that refuses answers 429 `rate-limited` with `Retry-After`, Better Auth not asked. Every
 * other refusal Better Auth answers reaches the client as its status and `{ code }` alone, a
 * failure (500 or more) as `internal`: nothing of its message, its cookies or the rest of its body.
 */
export function authHandler(
  deps: AuthMountDeps,
): (request: Request, from: string) => Promise<Response | undefined> {
  return async (request, from) => {
    const { pathname } = new URL(request.url)

    if (!pathname.startsWith(AUTH_PATHS)) {
      return undefined
    }

    const answer = SERVED_PATHS.get(pathname)

    if (answer === undefined) {
      return Response.json({ code: 'not-found' }, { status: 404 })
    }

    if (request.method !== 'POST') {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    }

    return answer(deps, request, from)
  }
}
