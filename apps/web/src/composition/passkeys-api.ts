/**
 * The gateway's routes of the signed-in account's passkeys over HTTP, called with the device's
 * session token and its id (`X-Perch-Device`); the browser's window is the ceremony's.
 */

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { PasskeysPort, PasskeyView } from '../platform/passkeys.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'
import { type PasskeyCeremony, passkeyCreationOptions } from './passkey-ceremony'

const listed = z.array(z.object({ id: idSchemas.passkey.schema, createdAt: z.iso.datetime() }))

/** The options of a registration with the challenge that goes back with the browser's answer. */
const registration = z.object({ options: passkeyCreationOptions, challenge: z.string().min(1) })

const view = (passkey: z.infer<typeof listed>[number]): PasskeyView => ({
  id: passkey.id,
  createdAt: new Date(passkey.createdAt),
})

/**
 * `GET <baseUrl>/passkeys`, `POST <baseUrl>/passkeys/options`, `POST <baseUrl>/passkeys` and
 * `DELETE <baseUrl>/passkeys/:id`. Adding asks for the options, has `ceremony` make the passkey
 * (a window closed or timed out is `data:PASSKEY_CANCELLED`, and the gateway is asked for no
 * passkey) and sends what the browser made with the options' challenge. A refusal fails as
 * `data:WRITE_REJECTED` with the gateway's code; any other answer but success names its status only.
 */
export function passkeysApi(
  baseUrl: string,
  deps: BearerDeps,
  ceremony: PasskeyCeremony,
): PasskeysPort {
  const calls = bearerCalls(baseUrl, deps)

  return {
    list: () => calls.json('/passkeys', 'GET', listed).map((passkeys) => passkeys.map(view)),
    add: () =>
      calls
        .json('/passkeys/options', 'POST', registration)
        .andThen(({ options, challenge }) =>
          ceremony
            .register(options)
            .andThen((response) => calls.empty('/passkeys', 'POST', { response, challenge })),
        ),
    remove: (id) => calls.empty(`/passkeys/${encodeURIComponent(id)}`, 'DELETE'),
  }
}
