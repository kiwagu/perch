/**
 * The whole gateway behind its server, for the specs that hold it to the platform's contract: a
 * gateway over embedded databases asked over HTTP as a device asks it, from an address of its own
 * for each request, with accounts signed up and verified through its Better Auth. The clock the
 * gateway reads is moved past every floor an answer waits on.
 */

import { expect, vi } from 'vitest'

import type { Locale } from '@workspace/i18n'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { deviceHeaders } from '../auth/__fixtures__/auth-instance'
import identityLocaleStatement from '../auth/__fixtures__/identity-locale.surql'
import identityRoleSetStatement from '../auth/__fixtures__/identity-role-set.surql'
import { profiledOn } from '../console/__fixtures__/profiles'
import { startServer } from '../server'
import { admitted } from '../tenants/__fixtures__/invitations'
import {
  closeHarness,
  deviceOf,
  harness,
  PASSWORD,
} from '../tenants/__fixtures__/organisation-routes'
import organisationSettingsWrite from '../tenants/__fixtures__/organisation-settings-write.surql'

/** An account signed in on its own device. */
export interface Account {
  readonly identity: IdentityId
  readonly email: string
  readonly device: string
  readonly token: string
  readonly password: string
}

/**
 * A request: its method and path (with its query), the account that sends it with its token, the
 * device it names, its JSON body.
 */
export interface Asked {
  readonly method: string
  readonly path: string
  readonly as?: Account
  /**
   * The device the request names, instead of the sender's own: with no sender, a guest's request
   * from that device, which carries no token.
   */
  readonly device?: string
  readonly body?: unknown
}

/** An answer: its status, its JSON body, the `code` of that body and its `Allow` header. */
export interface Answered {
  readonly status: number
  readonly body: unknown
  readonly code: string | undefined
  readonly allow: string | null
}

/** The devices of an account as `GET /devices` lists them, as far as a stand reads them. */
const listedDevices = z.object({
  devices: z.array(z.object({ id: z.string(), current: z.boolean() })),
})

/** The JSON a body holds, or none when it holds none. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The `code` of a JSON body that has one. */
function codeOf(body: unknown): string | undefined {
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : undefined
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

  /** An account that signed up and has not verified its email: it signs in on no device. */
  const unverified = async (): Promise<Account> => {
    issued++

    const email = `account-${issued}@example.test`
    const device = deviceOf(email)

    await base.root.auth.api.signUpEmail({
      body: { name: email, email, password: PASSWORD, locale: 'en' },
      headers: deviceHeaders(device),
    })

    const identity = (await base.root.sessions.identityOf(email))._unsafeUnwrap()

    return {
      identity: idSchemas.identity.schema.parse(identity),
      email,
      device,
      token: '',
      password: PASSWORD,
    }
  }

  /** An account that holds the platform role of an operator. */
  const operator = async (): Promise<Account> => {
    const made = await account()

    await base.root.local.db.query(identityRoleSetStatement, {
      identity: made.identity,
      role: CONTRACT_ROLES.operator,
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
  const ask = async ({ method, path, as, device, body }: Asked): Promise<Answered> => {
    issued++

    const headers = new Headers({ 'X-Forwarded-For': address() })

    if (as !== undefined) {
      headers.set('Authorization', `Bearer ${as.token}`)
    }

    const named = device ?? as?.device

    if (named !== undefined) {
      headers.set('X-Perch-Device', named)
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
    const answered = jsonOf(await response.text())

    return {
      status: response.status,
      body: answered,
      code: codeOf(answered),
      allow: response.headers.get('Allow'),
    }
  }

  /** The session id of a device of `owner` other than the one it asks from, signed in just now. */
  const otherDevice = async (owner: Account): Promise<string> => {
    const device = `${owner.device}-other`
    const signedIn = await ask({
      method: 'POST',
      path: '/auth/sign-in/email',
      as: owner,
      device,
      body: { email: owner.email, password: owner.password },
    })

    if (signedIn.status !== 200) {
      throw new Error(`the second device did not sign in: ${signedIn.status}`)
    }

    const { devices } = listedDevices.parse(
      (await ask({ method: 'GET', path: '/devices', as: owner })).body,
    )

    return devices.find((listed) => !listed.current)?.id ?? expect.unreachable('another device')
  }

  /** Moves the gateway's clock past every floor until `answer` settles. */
  const pastFloors = async (answer: Promise<Response>): Promise<Response> => {
    let settled = false

    void answer.then(
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

    return answer
  }

  /**
   * A guest's sign-up of a new `email` from the front in `locale`, answered by its status. The
   * clock moves past the floor only once the account exists, so the lookup of its starting
   * language, which comes before it, never runs out of its budget on the stand's clock.
   */
  const signUp = async (email: string, locale: Locale): Promise<number> => {
    issued++

    const answer = fetch(`${origin}/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: base.root.publicUrl,
        'X-Forwarded-For': address(),
      },
      body: JSON.stringify({ name: 'Newcomer', email, password: PASSWORD, locale }),
    })

    await vi.waitFor(async () =>
      expect((await base.root.sessions.identityOf(email))._unsafeUnwrap()).toBeDefined(),
    )

    return (await pastFloors(answer)).status
  }

  /** The id of an invitation of the organisation `key`, which `admin` administers. */
  const invitation = async (admin: Account, key: string): Promise<string> => {
    issued++

    return (
      await base.root.organisations.invitations.invite({
        actor: admin.identity,
        key,
        email: `invited-${issued}@example.test`,
        role: CONTRACT_ROLES.member,
      })
    )._unsafeUnwrap().id
  }

  return {
    account,
    unverified,
    operator,
    organisation,
    /** `member` joins the organisation `key` as a member, `admin` having invited it. */
    join: async (admin: Account, key: string, member: Account): Promise<void> => {
      await admitted(base.root.organisations, {
        actor: admin.identity,
        key,
        invitee: { id: member.identity, email: member.email },
      })
    },
    /** `owner` has its profile, as it has once a device of it started. */
    profile: async (owner: Account): Promise<void> => {
      await profiledOn(base.root.hub, owner.identity, owner.email, owner.email)
    },
    otherDevice,
    invitation,
    /** `admin` invites `email` into the organisation `key`. */
    invite: async (admin: Account, key: string, email: string): Promise<void> => {
      ;(
        await base.root.organisations.invitations.invite({
          actor: admin.identity,
          key,
          email,
          role: CONTRACT_ROLES.member,
        })
      )._unsafeUnwrap()
    },
    /** The organisation `key`'s settings row names `locale` as its default language. */
    defaultLanguage: async (key: string, locale: Locale): Promise<void> => {
      const handle = (await base.root.databases.acquire(key))._unsafeUnwrap()

      try {
        await handle.local.db.query(organisationSettingsWrite, {
          id: `ost_${key}`,
          content: { locale },
        })
      } finally {
        handle.release()
      }
    },
    signUp,
    /** The language stored on the identity of `email`. */
    localeOf: async (email: string): Promise<unknown> => {
      const [locale] = await base.root.local.db.query<[unknown]>(identityLocaleStatement, {
        email,
      })

      return locale
    },
    ask,
    /** The front's public origin the gateway was opened for, which its passkeys are bound to. */
    publicUrl: base.root.publicUrl,
    close: async () => {
      await server.stop()
      await closeHarness()
    },
  }
}

/** What `openStand` opened. */
export type Stand = Awaited<ReturnType<typeof openStand>>
