/**
 * The HTTP side of the smoke test: signing an identity up or in on a device through Better
 * Auth's routes, and calling the gateway's routes with the session token the device keeps. An
 * answer the smoke does not expect fails the step.
 *
 * The smoke and the load test talk to the gateway directly, so they play the front: like Caddy,
 * which names the address it saw in `X-Forwarded-For`, they give each simulated device a client
 * address of its own, `198.18.<a>.<b>` (a range set aside for benchmarks) from a stable hash of
 * the device id, so the gateway's limits per client address count each device apart.
 */

import { z } from '@workspace/zod'

/** What a sign-up or a sign-in answers, as far as the smoke reads it. */
const signedIn = z.object({
  /** The session token itself, which the device keeps and sends as its Bearer token. */
  token: z.string().min(1),
  user: z.object({ id: z.string(), email: z.string() }),
})

/** An identity signed in on a device: who it is, the session token the device keeps, its device. */
export interface SignedIn {
  readonly identity: { readonly id: string; readonly email: string }
  readonly token: string
  readonly device: string
}

/** A device as it names itself: its own id, and the label its owner sees in the list of devices. */
export interface NamedDevice {
  readonly id: string
  readonly label: string
}

/** What a device signs up or in with. */
export interface Credentials {
  readonly email: string
  readonly password: string
  readonly device: NamedDevice
  /** The account's own name, sent at a sign-up only; `Smoke` when left out. */
  readonly name?: string
}

/** Better Auth's routes a device signs up and in through, by email and password. */
export type CredentialsPath = '/auth/sign-up/email' | '/auth/sign-in/email'

/** What a route answered: its status, its headers and its body, which is not necessarily JSON. */
export interface Answer {
  readonly status: number
  readonly headers: Headers
  readonly body: unknown
}

/** A body as JSON when it parses, else as its text: a front may answer plain text for the gateway. */
function bodyOf(text: string): unknown {
  if (text === '') {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** The client address of a simulated device: `198.18.<a>.<b>` from a stable hash of its id. */
function simulatedAddress(device: string): string {
  const hash = Bun.hash.crc32(device)

  return `198.18.${(hash >>> 8) & 0xff}.${hash & 0xff}`
}

/** The headers naming the device a request comes from, its label too when it has one. */
function deviceHeaders(device: string | NamedDevice): Record<string, string> {
  const id = typeof device === 'string' ? device : device.id

  return {
    'X-Perch-Device': id,
    'X-Forwarded-For': simulatedAddress(id),
    ...(typeof device === 'string' ? {} : { 'X-Perch-Device-Label': device.label }),
  }
}

/** What a sign-up or a sign-in posts: a sign-up names the account, a sign-in does not. */
function credentialsBody(path: CredentialsPath, credentials: Credentials): unknown {
  const { email, password } = credentials

  return path === '/auth/sign-up/email'
    ? { name: credentials.name ?? 'Smoke', email, password }
    : { email, password }
}

/**
 * Signs up or in from the device `credentials` names (`X-Perch-Device` and its label in
 * `X-Perch-Device-Label`); the device keeps the session token of the answer. An answer other
 * than 200 fails with its status and body, which carry no token.
 */
export async function postCredentials(
  base: string,
  path: CredentialsPath,
  credentials: Credentials,
): Promise<SignedIn> {
  const answer = await call(
    base,
    'POST',
    path,
    undefined,
    credentialsBody(path, credentials),
    credentials.device,
  )

  if (answer.status !== 200) {
    throw new Error(`${path} answered ${answer.status} ${JSON.stringify(answer.body)}`)
  }

  const { token, user } = signedIn.parse(answer.body)

  return { identity: { id: user.id, email: user.email }, token, device: credentials.device.id }
}

/**
 * Calls a route of the gateway, as the holder of `token` when there is one, from `device`
 * (`X-Perch-Device`, its label when it has one, and the device's simulated address in
 * `X-Forwarded-For`) when one is named.
 */
export async function call(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string | undefined,
  body?: unknown,
  device?: string | NamedDevice,
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(device === undefined ? {} : deviceHeaders(device)),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()

  return { status: response.status, headers: response.headers, body: bodyOf(text) }
}

/** Calls a route of the gateway as `signedIn`: its session token, from its device. */
export function callAs(
  base: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  signedIn: SignedIn,
  body?: unknown,
): Promise<Answer> {
  return call(base, method, path, signedIn.token, body, signedIn.device)
}
