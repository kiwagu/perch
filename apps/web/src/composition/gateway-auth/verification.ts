/**
 * What the exchange of a verification link's token answers: the device signed in the first time,
 * nothing after, or why the link verifies nothing. The answer's body carries a session token, so
 * it is read only through its schema and an error names the status alone.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { answerBody, linkRefusedBy } from './answer-body'
import type { SignedInDevice } from './signed-in'

/** The account a first verification signed this device in to, as its sign-up named it. */
export interface VerifiedAccount {
  /** The account's own name: the profile starts with it. */
  readonly name: string
  /** The language the account signed up in: its settings start with it. */
  readonly locale: Locale
}

/** What a verification link's token did: signed this device in the first time, or nothing after. */
export type EmailVerification =
  | {
      readonly kind: 'signed-in'
      readonly device: SignedInDevice
      readonly account: VerifiedAccount
    }
  | { readonly kind: 'verified-before' }

/**
 * What a verification answers with: the raw session token and the account as it signed up the
 * first time, no token for an email verified before.
 */
const verifiedAnswer = z.union([
  z.object({
    token: z.string().min(1),
    user: z.object({
      id: idSchemas.identity.schema,
      email: z.string(),
      name: z.string(),
      locale: z.enum(SUPPORTED_LOCALES),
    }),
  }),
  z.object({ token: z.null() }),
])

const linkInvalid = () => dataError('data:LINK_INVALID', 'the gateway refused the link')

/** The outcome a verification's 200 carries. */
function outcomeOf(body: unknown): ResultAsync<EmailVerification, DataError> {
  const parsed = verifiedAnswer.safeParse(body)

  if (!parsed.success) {
    return errAsync(
      dataError(
        'data:AUTH_FAILED',
        'the gateway answered the verification with something other than its outcome',
      ),
    )
  }

  const answer = parsed.data

  return okAsync(
    answer.token === null
      ? { kind: 'verified-before' }
      : {
          kind: 'signed-in',
          device: {
            identity: { id: answer.user.id, email: answer.user.email },
            token: answer.token,
          },
          account: { name: answer.user.name, locale: answer.user.locale },
        },
  )
}

/**
 * What the gateway's answer to a verification means: its outcome (200); a link past its lifetime
 * (401 `link-expired`) or another it refused (any other 401, a 400); a request to wait (429); any
 * other answer fails naming its status.
 */
export function verificationOf(response: Response): ResultAsync<EmailVerification, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen(outcomeOf)
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) =>
      errAsync<EmailVerification, DataError>(refused),
    )
  }

  if (response.status === 400) {
    return errAsync(linkInvalid())
  }

  return errAsync(
    response.status === 429
      ? dataError('data:RATE_LIMITED', 'the gateway asks to wait before the verification')
      : dataError('data:AUTH_FAILED', `the gateway could not verify the link (${response.status})`),
  )
}
