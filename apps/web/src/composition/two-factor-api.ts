/**
 * The gateway's routes of the signed-in account's second factor over HTTP, called with the
 * device's session token and its id (`X-Perch-Device`).
 */

import { type DataError, dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { TwoFactorPort } from '../platform/two-factor.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'

const enabled = z.object({ enabled: z.boolean() })

const enrolment = z.object({
  key: z.string().min(1),
  uri: z.string().min(1),
  backupCodes: z.array(z.string().min(1)).length(10),
  enrolment: idSchemas.two_factor.schema,
})

const renewed = z.object({ backupCodes: z.array(z.string().min(1)).length(10) })

/** What the gateway's code of a refusal means here; any other stays `data:WRITE_REJECTED`. */
const REFUSALS: ReadonlyMap<string, DataError> = new Map([
  ['invalid-credentials', dataError('data:INVALID_CREDENTIALS', 'the password is wrong')],
  ['invalid-code', dataError('data:INVALID_CODE', 'the code is wrong')],
  [
    'two-factor-changed',
    dataError('data:TWO_FACTOR_CHANGED', 'the second factor changed meanwhile'),
  ],
  ['rate-limited', dataError('data:RATE_LIMITED', 'the gateway asks to wait')],
])

/** A rejection the bearer calls name by the gateway's code (`data:WRITE_REJECTED`), read by that code. */
const meant = (error: DataError): DataError =>
  (error.code === 'data:WRITE_REJECTED' ? REFUSALS.get(error.message) : undefined) ?? error

/**
 * `GET <baseUrl>/two-factor`, `POST <baseUrl>/two-factor/enable`, `/confirm`, `/disable` and
 * `/renew-codes`. A refusal fails as the port says (`data:INVALID_CREDENTIALS`,
 * `data:INVALID_CODE`, `data:TWO_FACTOR_CHANGED`, `data:RATE_LIMITED`) or as `data:WRITE_REJECTED`
 * with the gateway's code; any other answer but success names its status only, and a password,
 * a code or a key is never quoted.
 */
export function twoFactorApi(baseUrl: string, deps: BearerDeps): TwoFactorPort {
  const calls = bearerCalls(baseUrl, deps)

  return {
    read: () => calls.json('/two-factor', 'GET', enabled),
    enable: (password) =>
      calls.json('/two-factor/enable', 'POST', enrolment, { password }).mapErr(meant),
    confirm: (code, enrolled) =>
      calls.empty('/two-factor/confirm', 'POST', { code, enrolment: enrolled }).mapErr(meant),
    disable: (password) => calls.empty('/two-factor/disable', 'POST', { password }).mapErr(meant),
    renewCodes: (password) =>
      calls.json('/two-factor/renew-codes', 'POST', renewed, { password }).mapErr(meant),
  }
}
