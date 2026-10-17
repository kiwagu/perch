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

export type SignedIn = z.output<typeof signedIn>

/** What a route answered: its status and its body, which is not necessarily JSON. */
export interface Answer {
  readonly status: number
  readonly body: unknown
}

export async function postCredentials(
  base: string,
  path: string,
  credentials: { readonly email: string; readonly password: string },
): Promise<SignedIn> {
  const answer = await call(base, 'POST', path, undefined, credentials)

  if (answer.status !== 200) {
    throw new Error(`${path} answered ${answer.status} ${JSON.stringify(answer.body)}`)
  }

  return signedIn.parse(answer.body)
}

/** Calls a route of the gateway, as the holder of `token` when there is one. */
export async function call(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()

  return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) }
}
