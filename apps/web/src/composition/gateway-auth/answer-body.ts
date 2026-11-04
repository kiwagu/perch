/**
 * The body of a gateway answer, read once and never quoted: the code a refusal names, what a link
 * the gateway refused means, and what a conflict means.
 */

import { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { z } from '@workspace/zod'

/** The body of an answer as JSON, `undefined` when it has none. */
export const answerBody = (response: Response): ResultAsync<unknown, never> =>
  ResultAsync.fromSafePromise((response.json() as Promise<unknown>).catch(() => undefined))

const refusal = z.object({ code: z.string() })

/** The code a refusal's body names, `undefined` when it names none. */
export const refusalCode = (response: Response): ResultAsync<string | undefined, never> =>
  answerBody(response).map((body) => refusal.safeParse(body).data?.code)

/**
 * What a 401 to a link's token means: `link-expired` a link past its lifetime, any other a link
 * that does not work (unknown, used before or replaced by a newer one).
 */
export const linkRefusedBy = (response: Response): ResultAsync<DataError, never> =>
  refusalCode(response).map((code) =>
    code === 'link-expired'
      ? dataError('data:LINK_EXPIRED', 'the link is past its lifetime')
      : dataError('data:LINK_INVALID', 'the gateway refused the link'),
  )

/**
 * What a 409 means: `last-admin` an account that is the only administrator of an organisation
 * with other members, which blocks its deletion until those members are removed; any other code
 * is `otherwise`, the call's own reading of an answer it does not know.
 */
export const conflictRefusedBy = (
  response: Response,
  otherwise: DataError,
): ResultAsync<DataError, never> =>
  refusalCode(response).map((code) =>
    code === 'last-admin'
      ? dataError(
          'data:LAST_ADMIN',
          'the account is the only administrator of an organisation with other members',
        )
      : otherwise,
  )
