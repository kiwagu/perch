import { isAPIError } from 'better-auth/api'

import { idSchemas } from '@workspace/ids'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { KeyedTurns } from '../keyed-turns'
import type { RequestLimits } from '../limits/request-limits'
import { tooMany } from '../limits/too-many'
import { readBody } from '../read-body'

import type { AccountPasswords } from './account-passwords'
import {
  badRequest,
  confirmPassword,
  internal,
  type MountCaller,
  refused,
  stillSignedIn,
} from './auth-handler'
import type { AuthInstance } from './auth-instance'
import type { AuthSessions } from './auth-sessions'
import { bearerRefused, DEVICE_HEADER } from './bearer-caller'
import type { SecondFactorPolicy } from './second-factor-policy.port'
import { keyAccepts, keyShown } from './two-factor-key'
import type { TwoFactorRows } from './two-factor-rows'

/** What the routes work with: Better Auth, the account's sessions, passwords, limits and turn. */
export interface TwoFactorRoutesDeps {
  /** Better Auth, whose enable and renewal of codes run on the server for the caller's session. */
  readonly auth: Pick<AuthInstance, 'api' | '$context'>
  readonly sessions: Pick<AuthSessions, 'read'>
  /** The check of the password a change confirms with. */
  readonly passwords: Pick<AccountPasswords, 'matches'>
  readonly limits: Pick<RequestLimits, 'credentials' | 'signInAttempt'>
  /** One account's work, one turn at a time (`GatewayRoot.accountTurns`, by the identity's key). */
  readonly accounts: Pick<KeyedTurns<string>, 'run'>
  readonly rows: Pick<TwoFactorRows, 'read' | 'confirm' | 'disable'>
  /** Whether the account may turn its second factor on, and whether it must keep it on. */
  readonly policy: SecondFactorPolicy
}

/** Answers a change or a read of a signed-in caller's second factor. */
export type TwoFactorHandler = (
  deps: TwoFactorRoutesDeps,
  request: Request,
  from: string,
  caller: MountCaller,
) => Promise<Response>

/** The password is confirmed as typed: one of no account's length is a wrong one. */
const passwordBody = z.object({ password: z.string() })

const { minLength: CODE_MIN, maxLength: CODE_MAX } = CONTRACT_VALUES['second-factor-code']

/** A code of the key, as long as the contract's code of the second factor, and the enrolment. */
const confirmBody = z.object({
  code: z.string().min(CODE_MIN).max(CODE_MAX),
  enrolment: idSchemas.two_factor.schema,
})

const noContent = (): Response => new Response(null, { status: 204 })

/** 409 `two-factor-changed`: the factor is not as the request found it, and nothing changed. */
const changed = (): Response => refused(409, 'two-factor-changed')

/** 403 `failed`: the policy of the account's second factor refuses the change. */
const notAllowed = (): Response => refused(403, 'failed')

/**
 * The parsed body of a change, once the client address took one of its credential checks (429
 * when they are spent); 400 `bad-request` for a body that is not the schema's.
 */
async function bodyOf<T>(
  deps: Pick<TwoFactorRoutesDeps, 'limits'>,
  request: Request,
  from: string,
  schema: z.ZodType<T>,
): Promise<Response | T> {
  const checks = deps.limits.credentials(from)

  if (!checks.allowed) {
    return tooMany(checks)
  }

  const body = schema.safeParse(await readBody(request))

  return body.success ? body.data : badRequest()
}

/** The headers of a call of Better Auth on the server for the caller's session. */
const sessionHeaders = (caller: MountCaller): Headers =>
  new Headers({ authorization: `Bearer ${caller.token}`, [DEVICE_HEADER]: caller.device })

/**
 * The answer to a call of Better Auth that threw: 401 `unauthorized` when the caller's session
 * ended between the turn's read of it and Better Auth's own, 500 `internal` for anything else.
 */
const refusedBy = (cause: unknown): Response =>
  isAPIError(cause) && cause.statusCode === 401 ? bearerRefused() : internal()

const read: TwoFactorHandler = async ({ rows }, _request, _from, { identity }) => {
  const state = await rows.read(identity)

  return state.isErr() ? internal() : Response.json({ enabled: state.value.enabled })
}

const enable: TwoFactorHandler = async (deps, request, from, caller) => {
  const body = await bodyOf(deps, request, from, passwordBody)

  if (body instanceof Response) {
    return body
  }

  if (!(await deps.policy.decide(caller.identity)).allowed) {
    return notAllowed()
  }

  return deps.accounts.run(caller.identity, async () => {
    const confirmed = await confirmPassword(deps, caller, body.password)

    if (confirmed instanceof Response) {
      return confirmed
    }

    const before = await deps.rows.read(caller.identity)

    if (before.isErr()) {
      return internal()
    }

    // Better Auth would replace the key of a factor that is on: only the settings of one that is
    // off may ask for a new key.
    if (before.value.enabled) {
      return changed()
    }

    let started: { readonly totpURI: string; readonly backupCodes: readonly string[] }

    try {
      started = await deps.auth.api.enableTwoFactor({
        body: { password: body.password },
        headers: sessionHeaders(caller),
      })
    } catch (cause) {
      return refusedBy(cause)
    }

    // Better Auth replaced the account's row: the enrolment is the row it wrote.
    const after = await deps.rows.read(caller.identity)
    const key = keyShown(started.totpURI)

    if (after.isErr() || after.value.key === undefined || key === undefined) {
      return internal()
    }

    return Response.json({
      key,
      uri: started.totpURI,
      backupCodes: started.backupCodes,
      enrolment: after.value.key.enrolment,
    })
  })
}

const confirm: TwoFactorHandler = async (deps, request, from, caller) => {
  const body = await bodyOf(deps, request, from, confirmBody)

  if (body instanceof Response) {
    return body
  }

  return deps.accounts.run(caller.identity, async () => {
    const live = await stillSignedIn(deps, caller)

    if (live instanceof Response) {
      return live
    }

    const state = await deps.rows.read(caller.identity)

    if (state.isErr()) {
      return internal()
    }

    const { enabled, key } = state.value

    // The enrolment is the row the last enable wrote: another one names a key that was replaced,
    // and a factor that is on needs no confirmation.
    if (enabled || key === undefined || key.enrolment !== body.enrolment) {
      return changed()
    }

    let accepted: boolean

    try {
      accepted = await keyAccepts(deps.auth, key.secret, body.code)
    } catch {
      return internal()
    }

    if (!accepted) {
      return refused(400, 'invalid-code')
    }

    const turned = await deps.rows.confirm(caller.identity, key.enrolment)

    if (turned.isErr()) {
      return internal()
    }

    return turned.value === 'confirmed' ? noContent() : changed()
  })
}

const disable: TwoFactorHandler = async (deps, request, from, caller) => {
  const body = await bodyOf(deps, request, from, passwordBody)

  if (body instanceof Response) {
    return body
  }

  if ((await deps.policy.decide(caller.identity)).required) {
    return notAllowed()
  }

  return deps.accounts.run(caller.identity, async () => {
    const confirmed = await confirmPassword(deps, caller, body.password)

    if (confirmed instanceof Response) {
      return confirmed
    }

    const off = await deps.rows.disable(caller.identity)

    return off.isErr() ? internal() : noContent()
  })
}

const renew: TwoFactorHandler = async (deps, request, from, caller) => {
  const body = await bodyOf(deps, request, from, passwordBody)

  if (body instanceof Response) {
    return body
  }

  return deps.accounts.run(caller.identity, async () => {
    const confirmed = await confirmPassword(deps, caller, body.password)

    if (confirmed instanceof Response) {
      return confirmed
    }

    const state = await deps.rows.read(caller.identity)

    if (state.isErr()) {
      return internal()
    }

    if (!state.value.enabled) {
      return changed()
    }

    try {
      const { backupCodes } = await deps.auth.api.generateBackupCodes({
        body: { password: body.password },
        headers: sessionHeaders(caller),
      })

      return Response.json({ backupCodes })
    } catch (cause) {
      return refusedBy(cause)
    }
  })
}

/** The handler of each request the second factor's routes answer. */
export const TWO_FACTOR_HANDLERS = {
  read,
  enable,
  confirm,
  disable,
  renew,
} as const satisfies Record<string, TwoFactorHandler>
