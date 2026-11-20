/**
 * The whole gateway behind its server, for the specs that hold it to the platform's contract: a
 * gateway over embedded databases asked over HTTP as a device asks it, from an address of its own
 * for each request, with accounts signed up and verified through its Better Auth. The clock the
 * gateway reads is moved past every floor an answer waits on.
 */

import type { IdentityId } from '@workspace/ids'

import identityRoleSetStatement from '../auth/__fixtures__/identity-role-set.surql'
import { startServer } from '../server'
import {
  closeHarness,
  deviceOf,
  harness,
  PASSWORD,
} from '../tenants/__fixtures__/organisation-routes'

/** An account signed in on its own device. */
export interface Account {
  readonly identity: IdentityId
  readonly email: string
  readonly device: string
  readonly token: string
  readonly password: string
}

/** A request: its method and path (with its query), the account that sends it, its JSON body. */
export interface Asked {
  readonly method: string
  readonly path: string
  readonly as?: Account
  readonly body?: unknown
}

/** An answer: its status, the `code` of its JSON body and its `Allow` header. */
export interface Answered {
  readonly status: number
  readonly code: string | undefined
  readonly allow: string | null
}

/** The `code` of a JSON body that has one. */
function codeOf(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text)

    return typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
      ? body.code
      : undefined
  } catch {
    return undefined
  }
}

/** Opens the gateway and its server; `close` stops both. */
export async function openStand() {
  const base = await harness()
  const server = startServer(base.root, { port: 0, hostname: '127.0.0.1' })
  const origin = `http://127.0.0.1:${server.port}`
  let issued = 0

  /** A client address no earlier request came from, so no limit of an address ever holds one back. */
  const address = (): string => `198.18.${Math.floor(issued / 256) % 256}.${issued % 256}`

  /** An account signed up and verified on its own device. */
  const account = async (): Promise<Account> => {
    issued++

    const email = `account-${issued}@example.test`
    const { identity, token } = await base.signUp(email)

    return { identity: identity.id, email, device: deviceOf(email), token, password: PASSWORD }
  }

  /** An account that holds the platform role of an operator. */
  const operator = async (): Promise<Account> => {
    const made = await account()

    await base.root.local.db.query(identityRoleSetStatement, {
      identity: made.identity,
      role: 'operator',
    })

    return made
  }

  /** The key of an organisation `admin` made. */
  const organisation = async (admin: Account): Promise<string> => {
    issued++

    const key = `org${issued}`

    ;(
      await base.root.organisations.create({ identity: admin.identity, key, name: 'Acme' })
    )._unsafeUnwrap()

    return key
  }

  /** Sends the request and answers once the gateway did, moving its clock past every floor. */
  const ask = async ({ method, path, as, body }: Asked): Promise<Answered> => {
    issued++

    const headers = new Headers({ 'X-Forwarded-For': address() })

    if (as !== undefined) {
      headers.set('Authorization', `Bearer ${as.token}`)
      headers.set('X-Perch-Device', as.device)
    }

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const pending = fetch(`${origin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    let settled = false

    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    while (!settled) {
      if (base.time.pending() > 0) {
        await base.time.advance(1_000)
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    const response = await pending

    return {
      status: response.status,
      code: codeOf(await response.text()),
      allow: response.headers.get('Allow'),
    }
  }

  return {
    account,
    operator,
    organisation,
    ask,
    close: async () => {
      await server.stop()
      await closeHarness()
    },
  }
}

/** What `openStand` opened. */
export type Stand = Awaited<ReturnType<typeof openStand>>
