import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { z } from '@workspace/zod'

import type { IdentitySessions, SignedIn } from './identity-sessions'

/** What a device sends to sign up or in. */
const credentialsBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
})

/** The service call behind each path. */
const ACTIONS = new Map<string, 'signUp' | 'signIn'>([
  ['/auth/sign-up', 'signUp'],
  ['/auth/sign-in', 'signIn'],
])

async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown
  } catch {
    // A body that is not JSON fails the schema like any other wrong body.
    return undefined
  }
}

function signedInResponse({ identity, tokens }: SignedIn): Response {
  return Response.json({
    identity: { id: identity.id, email: identity.email },
    tokens: { access: tokens.access, refresh: tokens.refresh },
  })
}

function errorResponse(error: DataError): Response {
  return match(error.code)
    .with('data:SIGN_UP_REJECTED', () =>
      Response.json({ code: 'sign-up-rejected' }, { status: 409 }),
    )
    .with('data:INVALID_CREDENTIALS', () =>
      Response.json({ code: 'invalid-credentials' }, { status: 401 }),
    )
    .otherwise(() => Response.json({ code: 'internal' }, { status: 500 }))
}

/**
 * Sign-up and sign-in over HTTP: `POST /auth/sign-up` and `POST /auth/sign-in` with
 * `{ email, password }` answer `{ identity, tokens }`. A request for another path is not
 * answered here (`undefined`), so the server can try its other routes.
 */
export function authRoutes(
  sessions: Pick<IdentitySessions, 'signUp' | 'signIn'>,
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const action = ACTIONS.get(new URL(request.url).pathname)

    if (!action) {
      return undefined
    }

    if (request.method !== 'POST') {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    }

    const body = credentialsBody.safeParse(await readBody(request))

    if (!body.success) {
      return Response.json({ code: 'bad-request' }, { status: 400 })
    }

    const result = await sessions[action](body.data)

    return result.match(signedInResponse, errorResponse)
  }
}
