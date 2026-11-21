import { PASSKEY_ERROR_CODES } from '@better-auth/passkey'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { KeyedTurns } from '../keyed-turns'
import { readBody } from '../read-body'

import {
  badRequest,
  ceremonyOf,
  challengeValue,
  internal,
  internalRequest,
  type MountCaller,
  type PasskeyChallenges,
  refusalCodeOf,
  refused,
  stillSignedIn,
} from './auth-handler'
import type { AuthInstance } from './auth-instance'
import type { AuthSessions } from './auth-sessions'
import { bearerRefused } from './bearer-caller'
import { USER_NOT_VERIFIED } from './passkey-plugin'
import type { PasskeyRows } from './passkey-rows'

/** What the routes work with: Better Auth, the account's sessions, passkeys and turn. */
export interface PasskeyRoutesDeps {
  /** Better Auth, whose passkey plugin the gateway's own calls reach for the caller's session. */
  readonly auth: Pick<AuthInstance, 'handler'>
  readonly sessions: Pick<AuthSessions, 'read'>
  /** One account's work, one turn at a time (`GatewayRoot.accountTurns`, by the identity's key). */
  readonly accounts: Pick<KeyedTurns<string>, 'run'>
  readonly rows: Pick<PasskeyRows, 'list' | 'remove'>
  /** The name of the cookie a registration's challenge comes in. */
  readonly challenges: PasskeyChallenges
  /** The front's public origin, the base and the origin of the gateway's calls of the plugin. */
  readonly publicUrl: string
}

/** Answers a request of a signed-in caller about its passkeys; `id` is the passkey a path names. */
export type PasskeyHandler = (
  deps: PasskeyRoutesDeps,
  request: Request,
  caller: MountCaller,
  id: string,
) => Promise<Response>

/**
 * What an add names: the authenticator's answer to the options, which Better Auth's plugin reads
 * as it is, and the challenge of those options as the device carries it (one cookie value).
 */
const addBody = z.object({
  response: z.record(z.string(), z.unknown()),
  challenge: challengeValue,
})

/** Better Auth's codes of a registration it refused for what the device sent. */
const REFUSED_REGISTRATIONS: ReadonlySet<string> = new Set([
  USER_NOT_VERIFIED,
  PASSKEY_ERROR_CODES.CHALLENGE_NOT_FOUND.code,
  PASSKEY_ERROR_CODES.FAILED_TO_VERIFY_REGISTRATION.code,
  PASSKEY_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY.code,
])

/** The code of Better Auth's refusal of a call whose session it read as gone. */
const SESSION_GONE = 'UNAUTHORIZED'

/**
 * The answer to a refusal of the plugin: 401 `unauthorized` when the caller's session ended between
 * the turn's read of it and the plugin's own (a sign-out or a revocation, which take no turn), else
 * what `otherwise` makes of its code.
 */
async function refusalOf(
  answer: Response,
  otherwise: (code: string | undefined) => Response,
): Promise<Response> {
  const code = await refusalCodeOf(answer)

  return answer.status === 401 && code === SESSION_GONE ? bearerRefused() : otherwise(code)
}

/** A call of the plugin for the caller's session, from the caller's device. */
const forCaller = (deps: PasskeyRoutesDeps, caller: MountCaller) => ({
  publicUrl: deps.publicUrl,
  device: { id: caller.device, label: '' },
  bearer: caller.token,
})

const list: PasskeyHandler = async ({ rows }, _request, { identity }) => {
  const passkeys = await rows.list(identity)

  return passkeys.isErr()
    ? internal()
    : Response.json(
        passkeys.value.map(({ id, createdAt }) => ({ id, createdAt: createdAt.toISOString() })),
      )
}

const options: PasskeyHandler = async (deps, _request, caller) =>
  deps.accounts.run(caller.identity, async () => {
    const live = await stillSignedIn(deps, caller)

    if (live instanceof Response) {
      return live
    }

    const answer = await deps.auth.handler(
      internalRequest({ ...forCaller(deps, caller), path: '/passkey/generate-register-options' }),
    )

    if (answer.status !== 200) {
      return refusalOf(answer, internal)
    }

    const ceremony = await ceremonyOf(answer, await deps.challenges.cookieName())

    return ceremony === undefined ? internal() : Response.json(ceremony)
  })

const add: PasskeyHandler = async (deps, request, caller) => {
  const body = addBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  return deps.accounts.run(caller.identity, async () => {
    const live = await stillSignedIn(deps, caller)

    if (live instanceof Response) {
      return live
    }

    const answer = await deps.auth.handler(
      internalRequest({
        ...forCaller(deps, caller),
        path: '/passkey/verify-registration',
        challenge: { name: await deps.challenges.cookieName(), value: body.data.challenge },
        body: { response: body.data.response },
      }),
    )

    if (answer.status === 200) {
      return new Response(null, { status: 201 })
    }

    return refusalOf(answer, (code) =>
      code !== undefined && REFUSED_REGISTRATIONS.has(code) ? refused(400, 'failed') : internal(),
    )
  })
}

const remove: PasskeyHandler = async (deps, _request, caller, id) => {
  const passkey = idSchemas.passkey.schema.safeParse(id)

  // An id of another form, or longer than an id, names no passkey: refused before any is looked for.
  if (!passkey.success) {
    return badRequest()
  }

  return deps.accounts.run(caller.identity, async () => {
    const live = await stillSignedIn(deps, caller)

    if (live instanceof Response) {
      return live
    }

    const removed = await deps.rows.remove(caller.identity, passkey.data)

    if (removed.isErr()) {
      return internal()
    }

    return removed.value === 'removed'
      ? new Response(null, { status: 204 })
      : refused(404, 'failed')
  })
}

/** The handler of each request the passkey routes answer. */
export const PASSKEY_HANDLERS = {
  list,
  options,
  add,
  remove,
} as const satisfies Record<string, PasskeyHandler>
