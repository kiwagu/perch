/**
 * The HTTP side of the smoke test: signing an identity up or in, and calling the gateway's
 * routes with an access token. An answer the smoke does not expect fails the step.
 */

import { membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

const signedIn = z.object({
  identity: z.object({ id: z.string(), email: z.string() }),
  tokens: z.object({ access: z.string(), refresh: z.string() }),
  memberships: z.array(membership),
})

/** An identity signed in on a device: what the gateway answered, and the id of the device. */
export type SignedIn = z.output<typeof signedIn> & { readonly device: string }

/** What a device sends to sign up or in. */
export interface Credentials {
  readonly email: string
  readonly password: string
  readonly device: { readonly id: string; readonly label: string }
}

/** What a route answered: its status and its body, which is not necessarily JSON. */
export interface Answer {
  readonly status: number
  readonly body: unknown
}

export async function postCredentials(
  base: string,
  path: string,
  credentials: Credentials,
): Promise<SignedIn> {
  const answer = await call(base, 'POST', path, undefined, credentials)

  if (answer.status !== 200) {
    throw new Error(`${path} answered ${answer.status} ${JSON.stringify(answer.body)}`)
  }

  return { ...signedIn.parse(answer.body), device: credentials.device.id }
}

/**
 * Calls a route of the gateway, as the holder of `token` when there is one, from `device`
 * (`X-Perch-Device`) when one is named.
 */
export async function call(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string | undefined,
  body?: unknown,
  device?: string,
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(device === undefined ? {} : { 'X-Perch-Device': device }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()

  return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) }
}

/** Calls a route of the gateway as `signedIn`: its access token, from its device. */
export function callAs(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  signedIn: SignedIn,
  body?: unknown,
): Promise<Answer> {
  return call(base, method, path, signedIn.tokens.access, body, signedIn.device)
}
