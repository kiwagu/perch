/**
 * The console's routes beside the auth mount, over one real Better Auth on an embedded directory,
 * for the specs of an operator's actions on accounts: both answer over the very same sessions,
 * turns, limits, mails, organisations and sockets (`mountedOnRealAuth`'s `deps`), so an operator's
 * action and the account's own requests meet as they do in the gateway. A profile's name is
 * written through a real region hub over the directory.
 */

import { expect } from 'vitest'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'

import type { AuthMountDeps } from '../../auth/auth-handler'
import {
  mountedOnRealAuth,
  type RealMountOptions,
  type SignedInAccount,
  signedInOn,
} from '../../auth/auth-handler/__fixtures__/mount'
import { AccountBans } from '../account-bans'
import { AccountDirectory } from '../account-directory'
import { type ConsoleRoutesOptions, consoleRoutes } from '../console-routes'
import { ProfileNames } from '../profile-names'

import { consoleRequest, type SignedIn, setRole } from './operators'
import { hubOver } from './profiles'

/** The operator's email. */
export const OPERATOR = 'ops@example.test'

/** The client address an operator's request comes from, unless a test names another. */
export const OPERATOR_ADDRESS = '203.0.113.9'

/** The device the operator's console runs on. */
const CONSOLE = 'console'

/** A console route's answer: its status, its JSON body (none when empty) and its `Retry-After`. */
export interface ConsoleAnswer {
  readonly status: number
  readonly body: unknown
  readonly retryAfter: string | null
}

export interface ConsoleMountOptions extends RealMountOptions {
  /** Stands between the console and the account's rows, given what the mount removes them with. */
  readonly teardown?: (real: AuthMountDeps['teardown']) => ConsoleRoutesOptions['teardown']
}

async function answered(response: Response | undefined): Promise<ConsoleAnswer> {
  if (response === undefined) {
    return expect.unreachable('the routes answered nothing')
  }

  const text = await response.text()

  return {
    status: response.status,
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
    retryAfter: response.headers.get('Retry-After'),
  }
}

/** `account`, signed in with `email`, as a request from its `device` carries it. */
export function signedInAs(account: SignedInAccount, email: string, device: string): SignedIn {
  const token = account.tokens.get(device) ?? expect.unreachable('the device is signed in')

  return { identity: account.identity, email, device, token }
}

/**
 * The console's routes and the auth mount over one directory, with an operator signed in on its
 * console (`operator`); `act` asks an action of an account's path as the operator, or as `by`.
 * The failures the routes answered 500 for are kept in `consoleFailures`, a profile's writes go
 * through `hub`.
 */
export async function consoleOnMount(options: ConsoleMountOptions = {}) {
  const { teardown, ...mountOptions } = options
  const mounted = await mountedOnRealAuth(mountOptions)
  const { deps } = mounted
  const consoleFailures: DataError[] = []
  const hub = hubOver(mounted.local, mounted.clock)
  const routes = consoleRoutes({
    sessions: deps.sessions,
    accounts: new AccountDirectory(mounted.local),
    bans: new AccountBans({ directory: mounted.local, clock: mounted.clock }),
    names: new ProfileNames({ directory: mounted.local, hub }),
    emailChanges: deps.emailChanges,
    passwords: deps.passwords,
    auth: deps.auth,
    mails: deps.mails,
    limits: deps.limits,
    departure: deps.departure,
    teardown: teardown?.(deps.teardown) ?? deps.teardown,
    connections: deps.connections,
    turns: deps.accounts,
    onFailure: (error) => consoleFailures.push(error),
  })
  const operatorAccount = await signedInOn(mounted, OPERATOR, [CONSOLE])

  await setRole(mounted, operatorAccount.identity, 'operator')

  const operator = signedInAs(operatorAccount, OPERATOR, CONSOLE)

  /** `action` asked of `id`'s account (an identity id, or any text) by `by`, the operator unless named. */
  const act = async (
    id: string,
    action: string,
    body?: unknown,
    by: SignedIn = operator,
    from = OPERATOR_ADDRESS,
  ): Promise<ConsoleAnswer> =>
    answered(
      await routes(
        consoleRequest('POST', `/console/accounts/${id}/${action}`, { as: by, body }),
        from,
      ),
    )

  /** The identity `email` signs in to; the test fails when none does. */
  const identityOf = async (email: string): Promise<IdentityId> =>
    idSchemas.identity.schema.parse((await mounted.sessions.identityOf(email))._unsafeUnwrap())

  /** The account `identity` as the console's card reads it, or none once it is gone. */
  const card = async (identity: IdentityId) =>
    (await new AccountDirectory(mounted.local).read(identity))._unsafeUnwrap()

  return {
    ...mounted,
    limits: deps.limits,
    routes,
    consoleFailures,
    hub,
    operator,
    act,
    identityOf,
    card,
  }
}

/** What `consoleOnMount` opened. */
export type ConsoleMount = Awaited<ReturnType<typeof consoleOnMount>>
