import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { bearerRefused } from '../auth/bearer-caller'

import { type OrganisationError, refusalStatus } from './organisation-refusal'

/** Answers a request of the identity whose session it carries, from the client address `from`. */
export type Handler = (identity: IdentityId, request: Request, from: string) => Promise<Response>

/** The failures of the gateway a request was answered 500 for, which the answer itself leaves out. */
export type FailureListener = (error: DataError) => void

/** 400 `bad-request`: a body, a path or a header that does not follow its schema. */
export function badRequest(): Response {
  return Response.json({ code: 'bad-request' }, { status: 400 })
}

/**
 * What a route answers an error of an organisation command: a refusal its code with its status; a
 * failure of the gateway 500 `internal` without its cause, which `onFailure` hears.
 */
export function errorAnswer(onFailure: FailureListener): (error: OrganisationError) => Response {
  return (error) => {
    if ('kind' in error) {
      return Response.json({ code: error.code }, { status: refusalStatus(error.code) })
    }

    onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }
}

/**
 * As `errorAnswer`, for a command of the signed-in account itself: an account gone by the
 * command's turn had its account deleted after its session was read, and the session went with
 * it, so `no-such-identity` answers as a token that holds no session does.
 */
export function callerErrorAnswer(
  onFailure: FailureListener,
): (error: OrganisationError) => Response {
  const answer = errorAnswer(onFailure)

  return (error) =>
    'kind' in error && error.code === 'no-such-identity' ? bearerRefused() : answer(error)
}
