/**
 * The organisation routes over a gateway on embedded databases, for the route specs: a harness
 * with three identities signed up, the requests they send and the answers read back.
 */

import { expect } from 'vitest'

import type { DataError } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { deviceHeaders } from '../../auth/__fixtures__/auth-instance'
import { createGatewayRoot, type GatewayRoot } from '../../composition/root'
import { RequestLimits } from '../../limits/request-limits'
import { organisationRoutes } from '../organisation.routes'

const PASSWORD = 'pass-word-1'

/** An identity signed up on its device: its id and email, and its raw session token. */
export interface SignedUp {
  readonly identity: { readonly id: IdentityId; readonly email: string }
  readonly token: string
}

/** Closes what a test opened. */
const cleanups: Array<() => Promise<void>> = []

/** Failures the routes answered 500 for; a test that expects one takes it. */
export const failures: DataError[] = []

/** Closes what the test opened, last first, and checks no failure was left that it did not take. */
export async function closeHarness(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
}

/** What the routes are given besides the services: they hand each failure to `failures`. */
export function routeOptions(limits: RequestLimits) {
  return { onFailure: (error: DataError) => failures.push(error), limits }
}

/** The client address a request comes from unless a test names another. */
export const ADDRESS = '203.0.113.1'

export interface Ask {
  /**
   * The identity whose session token goes as `Authorization: Bearer <token>`, from the device it
   * signed up on (`X-Perch-Device`).
   */
  readonly as?: SignedUp
  /** The `Authorization` header exactly as sent, for one a device should not send. */
  readonly authorization?: string
  /** The `X-Perch-Device` header instead of the caller's device; `null` leaves it out. */
  readonly device?: string | null
  /** The JSON body, or a text sent as it is. */
  readonly body?: unknown
  /** The client address the request comes from, instead of `ADDRESS`. */
  readonly from?: string
}

/** The device each identity of these tests signs up on. */
export function deviceOf(email: string): string {
  return `device-${email}`
}

export function request(method: string, path: string, ask: Ask = {}): Request {
  const headers = new Headers()
  const authorization = ask.as ? `Bearer ${ask.as.token}` : ask.authorization
  const device = ask.device === undefined && ask.as ? deviceOf(ask.as.identity.email) : ask.device

  if (authorization !== undefined) {
    headers.set('Authorization', authorization)
  }

  if (device !== undefined && device !== null) {
    headers.set('X-Perch-Device', device)
  }

  if (ask.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  return new Request(`http://gateway.test${path}`, {
    method,
    headers,
    ...(ask.body === undefined
      ? {}
      : { body: typeof ask.body === 'string' ? ask.body : JSON.stringify(ask.body) }),
  })
}

export async function answer(
  response: Response | undefined,
): Promise<{ status: number; body: unknown }> {
  if (!response) {
    return expect.unreachable('the route answered nothing')
  }

  const text = await response.text()
  const body: unknown = text === '' ? undefined : (JSON.parse(text) as unknown)

  return { status: response.status, body }
}

async function openRoot(): Promise<GatewayRoot> {
  const root = (
    await createGatewayRoot({
      engines: nodeEngines(),
      url: 'mem://',
      clock: manualClock(),
      authSecret: 'test-secret-0123456789-0123456789-0123456789',
      publicUrl: 'http://localhost',
    })
  )._unsafeUnwrap()

  cleanups.push(() => root.close())

  return root
}

/**
 * The routes over a gateway on embedded databases, the directory and one per organisation, with
 * three identities signed up through its Better Auth: ann, bob and cat; `signUp` signs up another.
 */
export async function harness() {
  const root = await openRoot()
  const clock = manualClock(1_000)
  const routes = organisationRoutes(
    root.sessions,
    root.organisations,
    routeOptions(new RequestLimits({ clock })),
  )
  const signUp = async (email: string): Promise<SignedUp> => {
    const { token, user } = await root.auth.api.signUpEmail({
      body: { name: email, email, password: PASSWORD },
      headers: deviceHeaders(deviceOf(email)),
    })

    return {
      identity: { id: idSchemas.identity.schema.parse(user.id), email: user.email },
      token: token ?? expect.unreachable(`the sign-up of ${email} answered a session token`),
    }
  }
  const ann = await signUp('ann@example.test')
  const bob = await signUp('bob@example.test')
  const cat = await signUp('cat@example.test')

  /** Sends the request to the routes and reads their answer. */
  const ask = async (method: string, path: string, options: Ask = {}) =>
    answer(await routes(request(method, path, options), options.from ?? ADDRESS))

  /** Ann creates acme, for a test to start from. */
  const founded = async () =>
    (
      await root.organisations.create({ identity: ann.identity.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()

  /** Ann invites bob into acme, for a test to start from. */
  const invited = async () =>
    (
      await root.organisations.invite({
        actor: ann.identity.id,
        key: 'acme',
        email: 'bob@example.test',
      })
    )._unsafeUnwrap()

  return { root, routes, clock, ann, bob, cat, signUp, ask, founded, invited }
}
