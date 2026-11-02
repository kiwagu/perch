import { verifyJWT } from 'better-auth/crypto'
import { err, ok, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { AuthInstance } from '../auth-instance'

/** The session a verification signed in and its account, as the device and its screens need them. */
export interface SignedInAccount {
  /** The raw session token, which the device keeps and presents. */
  readonly token: string
  readonly user: {
    readonly id: IdentityId
    readonly email: string
    readonly name: string
    readonly locale: Locale
  }
}

/** What Better Auth answers for the session a verification signed in. */
const signedInAnswer = z.object({
  session: z.object({ token: z.string().min(1) }),
  user: z.object({
    id: idSchemas.identity.schema,
    email: z.string(),
    name: z.string(),
    locale: z.enum(SUPPORTED_LOCALES),
  }),
})

/** What a verification link's token names. */
const tokenClaims = z.object({ email: z.string() })

/**
 * The session Better Auth signed in at a verification, read by the signed token of its answer
 * (`set-auth-token`, which only Better Auth's own answer carries): the raw token and the account;
 * none when the token reads no session.
 */
export function readSignedIn(
  auth: AuthInstance,
  signedToken: string,
): ResultAsync<SignedInAccount | undefined, DataError> {
  return ResultAsync.fromPromise(
    auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${signedToken}` }) }),
    (cause) =>
      dataError('data:QUERY_FAILED', 'could not read the session a verification signed in', cause),
  ).andThen((answer) => {
    if (answer === null) {
      return ok(undefined)
    }

    const parsed = signedInAnswer.safeParse(answer)

    return parsed.success
      ? ok({ token: parsed.data.session.token, user: parsed.data.user })
      : err(
          dataError(
            'data:QUERY_FAILED',
            'the session a verification signed in has an unknown shape',
          ),
        )
  })
}

/**
 * The email a verification link's token names, in lower case, read with Better Auth's secret as
 * Better Auth reads it; none for a token it did not sign, or one past its lifetime.
 */
export async function readVerificationEmail(
  token: string,
  secret: string,
): Promise<string | undefined> {
  const claims = tokenClaims.safeParse(await verifyJWT(token, secret))

  return claims.success ? claims.data.email.toLowerCase() : undefined
}
