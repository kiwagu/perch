import { describe, expect, it } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import type { AccountsPort, Acted } from '../platform/accounts.port'

import { fakeFetch, noContent, respond } from './__fixtures__/gateway-fetch'
import { accountsApi } from './accounts-api'

const ann = { identity: identityIdFactory.create(), token: 'token-ann' }
const cara = identityIdFactory.create()

/** The client over `fetcher`, asking as Ann with her token, the roles dropped into `dropped`. */
function api(fetcher: ReturnType<typeof fakeFetch>['fetcher']) {
  const dropped: Array<readonly [IdentityId, PlatformRole]> = []
  const client = accountsApi('/backend', {
    credentials: () => ann,
    device: () => 'device-1',
    dropRole: (identity, role) => {
      dropped.push([identity, role])
    },
    fetcher,
  })

  return { client, dropped }
}

/** One action of the card on Cara's account, as the port names it, with what it sends. */
interface Action {
  readonly name: string
  readonly run: (client: AccountsPort) => Acted<string>
  readonly path: string
  readonly body: unknown
  /** The codes the gateway answers that are the action's own, besides `not-operator`. */
  readonly own: ReadonlyArray<readonly [status: number, code: string]>
}

const ACTIONS: readonly Action[] = [
  {
    name: 'rename',
    run: (client) => client.rename(cara, 'Cara Smith'),
    path: 'rename',
    body: { name: 'Cara Smith' },
    own: [
      [400, 'name-required'],
      [400, 'name-too-long'],
      [404, 'account-gone'],
      [409, 'failed'],
    ],
  },
  {
    name: 'changeEmail',
    run: (client) => client.changeEmail(cara, 'cara@example.org'),
    path: 'email',
    body: { email: 'cara@example.org' },
    own: [
      [400, 'email-invalid'],
      [409, 'email-taken'],
      [429, 'rate-limited'],
      [404, 'account-gone'],
    ],
  },
  {
    name: 'ban',
    run: (client) => client.ban(cara, 'spam'),
    path: 'ban',
    body: { reason: 'spam' },
    own: [
      [409, 'own-account'],
      [404, 'account-gone'],
    ],
  },
  {
    name: 'unban',
    run: (client) => client.unban(cara),
    path: 'unban',
    body: undefined,
    own: [[404, 'account-gone']],
  },
  {
    name: 'revokeSessions',
    run: (client) => client.revokeSessions(cara),
    path: 'sign-out',
    body: undefined,
    own: [
      [409, 'own-account'],
      [404, 'account-gone'],
    ],
  },
  {
    name: 'sendReset',
    run: (client) => client.sendReset(cara),
    path: 'reset',
    body: undefined,
    own: [
      [429, 'rate-limited'],
      [404, 'account-gone'],
    ],
  },
  {
    name: 'resendVerification',
    run: (client) => client.resendVerification(cara),
    path: 'verification',
    body: undefined,
    own: [
      [409, 'verified-before'],
      [429, 'rate-limited'],
      [404, 'account-gone'],
    ],
  },
  {
    name: 'remove',
    run: (client) => client.remove(cara),
    path: 'removal',
    body: undefined,
    own: [
      [409, 'last-admin'],
      [409, 'own-account'],
      [404, 'account-gone'],
    ],
  },
]

/** A code of one action that another action does not answer with: `failed` there. */
const FOREIGN: Readonly<Record<string, readonly [number, string]>> = {
  rename: [409, 'email-taken'],
  changeEmail: [409, 'own-account'],
  ban: [429, 'rate-limited'],
  unban: [409, 'own-account'],
  revokeSessions: [409, 'last-admin'],
  sendReset: [409, 'verified-before'],
  resendVerification: [400, 'name-required'],
  remove: [429, 'rate-limited'],
}

describe("accountsApi's actions on an account", () => {
  it.each(ACTIONS)(
    '$name posts to its console route with the bearer token and the device, done on a 204',
    async (action) => {
      const { fetcher, sent } = fakeFetch(noContent())

      expect((await action.run(api(fetcher).client))._unsafeUnwrap()).toBeUndefined()
      expect(sent).toEqual([
        {
          url: `/backend/console/accounts/${cara}/${action.path}`,
          method: 'POST',
          authorization: 'Bearer token-ann',
          device: 'device-1',
          body: action.body,
        },
      ])
    },
  )

  it.each(ACTIONS)(
    '$name fails with each of its own codes as the gateway answers it',
    async (action) => {
      for (const [status, code] of action.own) {
        const { fetcher } = fakeFetch(respond(status, { code }))

        expect((await action.run(api(fetcher).client))._unsafeUnwrapErr().code).toBe(code)
      }
    },
  )

  it.each(ACTIONS)(
    '$name fails with failed for a bad request, a code of another action, a 401, a 500 and offline',
    async (action) => {
      const [status, code] = FOREIGN[action.name] ?? expect.unreachable('a foreign code')
      const answers = [
        respond(400, { code: 'bad-request' }),
        respond(status, { code }),
        respond(401, { code: 'unauthorized' }),
        respond(500, { code: 'internal' }),
        () => Promise.reject(new TypeError('Failed to fetch')),
      ]

      for (const answer of answers) {
        const { client, dropped } = api(fakeFetch(answer).fetcher)

        expect((await action.run(client))._unsafeUnwrapErr().code).toBe('failed')
        expect(dropped).toEqual([])
      }
    },
  )

  it.each(ACTIONS)(
    "$name refused with not-operator takes operator off the asker's roles",
    async (action) => {
      const { client, dropped } = api(fakeFetch(respond(403, { code: 'not-operator' })).fetcher)

      expect((await action.run(client))._unsafeUnwrapErr().code).toBe('not-operator')
      expect(dropped).toEqual([[ann.identity, 'operator']])
    },
  )

  it('sends the reason of a ban as typed, an empty one included, for the gateway to trim', async () => {
    const { fetcher, sent } = fakeFetch(noContent())
    const { client } = api(fetcher)

    expect((await client.ban(cara, '')).isOk()).toBe(true)
    expect((await client.ban(cara, '  spam  ')).isOk()).toBe(true)

    expect(sent.map(({ body }) => body)).toEqual([{ reason: '' }, { reason: '  spam  ' }])
  })

  it("encodes the account's id into the path", async () => {
    const { fetcher, sent } = fakeFetch(noContent())
    const odd = 'idn_a/b?c' as IdentityId

    expect((await api(fetcher).client.unban(odd)).isOk()).toBe(true)

    expect(sent.map(({ url }) => url)).toEqual(['/backend/console/accounts/idn_a%2Fb%3Fc/unban'])
  })
})
