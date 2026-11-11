import { z } from '@workspace/zod'

import { FRONT_PREFIX } from '../../config'

/** The paths of Better Auth's routes, as the gateway receives them from the front. */
export const AUTH_PATHS = '/auth/'

/**
 * The URL Better Auth serves the request under: the front's prefix, which the front stripped, put
 * back in front of `/auth/<rest>`, the query kept.
 */
export function publicUrl(request: Request): string {
  const url = new URL(request.url)

  url.pathname = `${FRONT_PREFIX}${url.pathname}`

  return url.href
}

/**
 * The request at the path Better Auth serves it under, carrying `body` as JSON, with `headers`
 * (the request's own unless named). Better Auth reads a body by its content type, a form too, so
 * a body that reads as JSON naming one email and as a form naming another would have the other
 * email's password checked while the first one is counted: it is handed the very body the mount
 * read. The length is the new body's.
 */
export function withJsonBody(
  request: Request,
  body: unknown,
  headers: Headers = request.headers,
): Request {
  const sent = new Headers(headers)

  sent.delete('content-length')
  sent.delete('transfer-encoding')
  sent.set('content-type', 'application/json')

  return new Request(publicUrl(request), {
    method: request.method,
    headers: sent,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

/** The headers of a request without the credentials it carried: Better Auth must see no session. */
export function withoutCredentials(headers: Headers): Headers {
  const kept = new Headers(headers)

  for (const name of [
    'authorization',
    'cookie',
    'content-type',
    'content-length',
    'transfer-encoding',
  ]) {
    kept.delete(name)
  }

  return kept
}

const refusalCode = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })

/**
 * Better Auth's refusal as the client gets it: its status and its code, nothing of its message,
 * its cookies or any other part of its body, which can carry what was sent or what failed.
 */
export async function refusalOf(answer: Response): Promise<Response> {
  const body = refusalCode.safeParse(await answer.json().catch(() => undefined))
  const code = answer.status >= 500 ? 'internal' : body.success ? body.data.code : 'bad-request'

  return Response.json({ code }, { status: answer.status })
}

/** 400 `bad-request`: a body or a header the route cannot read. */
export const badRequest = (): Response => Response.json({ code: 'bad-request' }, { status: 400 })

/** 500 `internal`: the gateway failed, nothing of why. */
export const internal = (): Response => Response.json({ code: 'internal' }, { status: 500 })

/** A refusal by `code` with `status`, nothing else in its body. */
export const refused = (status: number, code: string): Response =>
  Response.json({ code }, { status })
