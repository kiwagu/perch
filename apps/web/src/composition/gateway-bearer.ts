/**
 * Calls of the gateway's routes that act for the signed-in device: each carries the device's
 * session token (`Authorization: Bearer`) and its id (`X-Perch-Device`). A refused token is dead,
 * so the call is not made again.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { z } from '@workspace/zod'

import type { Fetcher } from './gateway-auth'

export interface BearerDeps {
  /** The session token the device holds now, if any. */
  readonly token: () => string | undefined
  /** The device's own id, named in every call: the gateway acts on the device's session. */
  readonly device: () => string
  readonly fetcher?: Fetcher
}

/** The calls of the routes under one base address. */
export interface BearerCalls {
  /** A call answered with a body, read with `schema`; a refusal fails. */
  json<T>(
    path: string,
    method: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): ResultAsync<T, DataError>
  /** A call answered without a body (204); a refusal fails. */
  empty(path: string, method: string, body?: unknown): ResultAsync<void, DataError>
}

const refusalBody = z.object({ code: z.string() })

/** The statuses the gateway refuses a request with a code of its own. */
const REJECTED = new Set([400, 403, 404, 409, 429])

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

/**
 * What a refused request means: `data:WRITE_REJECTED` with the gateway's code as its message for
 * a rejection, `data:AUTH_FAILED` naming the status otherwise (never the body).
 */
function refusal(response: Response): ResultAsync<never, DataError> {
  if (!REJECTED.has(response.status)) {
    return errAsync(authFailed(`the gateway refused the request with ${response.status}`))
  }

  return readBody(response, refusalBody).andThen((body) =>
    errAsync(dataError('data:WRITE_REJECTED', body.code)),
  )
}

/**
 * The gateway's routes under `baseUrl`, called with the device's session token and id. A fetch
 * that throws is `data:OFFLINE`; no token, or a token the gateway refuses (401), is
 * `data:AUTH_FAILED` without a second request.
 */
export function bearerCalls(baseUrl: string, deps: BearerDeps): BearerCalls {
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
          'X-Perch-Device': deps.device(),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      (cause) => dataError('data:OFFLINE', 'could not reach the gateway', cause),
    )

  /** One request with the token the device holds now; a 401 ends it: the token is dead. */
  const withToken = (
    path: string,
    method: string,
    body?: unknown,
  ): ResultAsync<Response, DataError> => {
    const token = deps.token()

    if (token === undefined) {
      return errAsync(authFailed('the device holds no session token'))
    }

    return send(path, method, token, body).andThen((response) =>
      response.status === 401
        ? errAsync(authFailed('the gateway refused the session token'))
        : okAsync(response),
    )
  }

  return {
    json: (path, method, schema, body) =>
      withToken(path, method, body).andThen((response) =>
        response.ok ? readBody(response, schema) : refusal(response),
      ),
    empty: (path, method, body) =>
      withToken(path, method, body).andThen((response) =>
        response.ok ? okAsync(undefined) : refusal(response),
      ),
  }
}
