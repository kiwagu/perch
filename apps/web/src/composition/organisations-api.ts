/**
 * The gateway's organisation routes over HTTP, called with the device's access token. A refused
 * token is renewed once through the sync leader and the call is made again.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { type Membership, membership, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { MemberView } from '../platform/organisations.port'

import type { Fetcher } from './gateway-auth'

export interface OrganisationsApi {
  list(): ResultAsync<readonly Membership[], DataError>
  create(input: { key: string; name: string }): ResultAsync<Membership, DataError>
  members(key: string): ResultAsync<readonly MemberView[], DataError>
  invite(key: string, email: string): ResultAsync<MemberView, DataError>
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError>
}

export interface OrganisationsApiDeps {
  /** The access token the device holds now, if any. */
  readonly token: () => string | undefined
  /** Gets a new access token for `token()`; false when none could be had. */
  readonly renew: () => Promise<boolean>
  readonly fetcher?: Fetcher
}

const memberView = z.object({
  identity: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  role: tenantRole,
})

const refusalBody = z.object({ code: z.string() })

const REJECTED = new Set([400, 403, 404, 409])

const authFailed = (message: string) => dataError('data:AUTH_FAILED', message)

/** Reads the answer's body once with `schema`; a body that does not match fails with the status. */
function readBody<T>(response: Response, schema: z.ZodType<T>): ResultAsync<T, DataError> {
  const unexpected = (cause?: unknown) =>
    dataError(
      'data:AUTH_FAILED',
      `the gateway answered ${response.status} with something unexpected`,
      cause,
    )

  return ResultAsync.fromPromise(response.json() as Promise<unknown>, unexpected).andThen(
    (body) => {
      const parsed = schema.safeParse(body)

      return parsed.success ? okAsync(parsed.data) : errAsync(unexpected(parsed.error))
    },
  )
}

/** What a refused request means: the gateway's code for a rejection, the status otherwise. */
function refusal(response: Response): ResultAsync<never, DataError> {
  if (!REJECTED.has(response.status)) {
    return errAsync(authFailed(`the gateway refused the request with ${response.status}`))
  }

  return readBody(response, refusalBody).andThen((body) =>
    errAsync(dataError('data:WRITE_REJECTED', body.code)),
  )
}

/** The gateway's `/organisations` routes under `baseUrl`. */
export function organisationsApi(baseUrl: string, deps: OrganisationsApiDeps): OrganisationsApi {
  const fetcher = deps.fetcher ?? fetch

  const send = (
    path: string,
    method: string,
    token: string,
    body?: unknown,
  ): ResultAsync<Response, DataError> =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      (cause) => dataError('data:OFFLINE', 'could not reach the gateway', cause),
    )

  /** One request with the current token; a 401 renews the token once and asks again. */
  const withToken = (
    path: string,
    method: string,
    body?: unknown,
  ): ResultAsync<Response, DataError> => {
    const first = deps.token()

    if (first === undefined) {
      return errAsync(authFailed('the device holds no access token'))
    }

    return send(path, method, first, body).andThen((response) => {
      if (response.status !== 401) {
        return okAsync(response)
      }

      return ResultAsync.fromPromise(deps.renew(), (cause) =>
        dataError('data:AUTH_FAILED', 'the access token could not be renewed', cause),
      ).andThen((renewed) => {
        const second = renewed ? deps.token() : undefined

        return second === undefined
          ? errAsync(authFailed('the gateway refused the access token'))
          : send(path, method, second, body).andThen((again) =>
              again.status === 401
                ? errAsync(authFailed('the gateway refused the renewed access token'))
                : okAsync(again),
            )
      })
    })
  }

  const call = <T>(
    path: string,
    method: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): ResultAsync<T, DataError> =>
    withToken(path, method, body).andThen((response) =>
      response.ok ? readBody(response, schema) : refusal(response),
    )

  const base = (key: string) => `/organisations/${encodeURIComponent(key)}/members`

  return {
    list: () =>
      call('/organisations', 'GET', z.object({ memberships: z.array(membership) })).map(
        (answer) => answer.memberships,
      ),
    create: (input) =>
      call('/organisations', 'POST', z.object({ membership }), input).map(
        (answer) => answer.membership,
      ),
    members: (key) =>
      call(base(key), 'GET', z.object({ members: z.array(memberView) })).map(
        (answer) => answer.members,
      ),
    invite: (key, email) =>
      call(base(key), 'POST', z.object({ member: memberView }), { email }).map(
        (answer) => answer.member,
      ),
    remove: (key, identity) =>
      withToken(`${base(key)}/${encodeURIComponent(identity)}`, 'DELETE').andThen((response) =>
        response.ok ? okAsync(undefined) : refusal(response),
      ),
  }
}
