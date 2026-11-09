import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import type { Inbox, Invited, OrganisationView, SeedClient } from '@workspace/web/seeding'

import { type Catalog, catalog } from '../catalog'

import { runSeed, seedOrganisations } from './run'

/** A mailbox that records each look: a run the gateway refuses at once never looks. */
function untouchedInbox() {
  const asked: string[] = []
  const inbox: Inbox = {
    count: (email) => {
      asked.push(`count ${email}`)

      return Promise.resolve(0)
    },
    verificationToken: (email) => {
      asked.push(`token ${email}`)

      return Promise.reject(new Error('no mail in this test'))
    },
  }

  return { asked, inbox }
}

describe('runSeed', () => {
  it("calls the gateway's routes through the fetcher it is given, signing in first", async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'demo' },
      inbox,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual(['http://127.0.0.1:9/auth/sign-in/email'])
    expect(seeded._unsafeUnwrapErr().message).toBe('the gateway refused the request with 503')
    expect(asked).toEqual([])
  })

  it('refuses a catalog the run would not hold before it sweeps or calls the gateway', async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const run = 'r'.repeat(40)
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'fresh', run },
      reset: true,
      inbox,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual([])
    expect(asked).toEqual([])
    expect(seeded._unsafeUnwrapErr()).toMatchObject({
      code: 'data:QUERY_FAILED',
      message: `the seed catalog is refused: organisation acme: key acme_${run} is not a tenant key`,
    })
  })
})

/** Ids the run never reads: it passes on the invitation an invite answers and nothing else. */
const someone = 'idn_0000000000000000.01m52pexcp' as AuthUser['id']
const someOrganisation =
  'tnt_0000000000000000.01m52pexcp' as OrganisationView['membership']['tenant']['id']

/**
 * A seed client that records what the run asks of it, in order. Each invite answers the id of a
 * new invitation, or `already-member` for the emails in `members`; an accept answers the
 * membership of the organisation the invitation was to.
 */
function recordingClient(members: readonly string[] = []) {
  const calls: string[] = []
  const invitedTo = new Map<string, string>()
  let invitations = 0
  const never = () => errAsync(dataError('data:QUERY_FAILED', 'the run asked for something else'))
  const client: SeedClient = {
    ensureAccount: never,
    readOrganisation: never,
    readAccount: never,
    close: () => Promise.resolve(),
    signIn: (input) => {
      calls.push(`sign in ${input.email}`)

      return okAsync({ id: someone, email: input.email })
    },
    ensureOrganisation: (input) => {
      calls.push(`create ${input.key}`)

      return okAsync({
        tenant: { id: someOrganisation, key: input.key, name: input.name },
        role: 'admin',
      })
    },
    ensureInvited: (key, email) => {
      calls.push(`invite ${email} to ${key}`)

      if (members.includes(email)) {
        return okAsync<Invited>({ kind: 'already-member' })
      }

      invitations += 1

      const invitation = `inv_${invitations}`

      invitedTo.set(invitation, email)

      return okAsync<Invited>({ kind: 'invited', invitation })
    },
    ensureJoined: (invitation) => {
      calls.push(`join as ${invitedTo.get(invitation) ?? `nobody by ${invitation}`}`)

      return okAsync({
        tenant: { id: someOrganisation, key: 'joined', name: 'Joined' },
        role: 'member',
      })
    },
  }

  return { client, calls }
}

describe('seedOrganisations', () => {
  it("has the administrator create and invite, then each member sign in and accept the invitation that member's invite answered", async () => {
    const { client, calls } = recordingClient()
    const manifest = (await seedOrganisations(client, catalog, { kind: 'demo' }))._unsafeUnwrap()

    expect(calls).toEqual([
      'sign in ann@example.test',
      'create acme',
      'invite beto@example.test to acme',
      'sign in beto@example.test',
      'join as beto@example.test',
    ])
    expect(manifest['acme']).toMatchObject({ key: 'acme', name: 'Acme Corp' })
  })

  it('joins nobody on a second run: the invite finds the members in the organisation already', async () => {
    const { client, calls } = recordingClient(['beto@example.test'])

    expect((await seedOrganisations(client, catalog, { kind: 'demo' })).isOk()).toBe(true)
    expect(calls).toEqual([
      'sign in ann@example.test',
      'create acme',
      'invite beto@example.test to acme',
    ])
  })

  it('gives each member its own invitation, and only the members invited this run accept', async () => {
    const { client, calls } = recordingClient(['cleo@example.test'])
    const several: Catalog = {
      accounts: [
        ...catalog.accounts,
        { ref: 'cleo', name: 'Cleo Example', bio: 'Another demo account.', locale: 'en' },
        { ref: 'dani', name: 'Dani Example', bio: 'One more demo account.', locale: 'en' },
      ],
      organisations: [
        {
          ref: 'acme',
          key: 'acme',
          name: 'Acme Corp',
          admin: 'ann',
          members: ['beto', 'cleo', 'dani'],
        },
      ],
    }

    expect((await seedOrganisations(client, several, { kind: 'demo' })).isOk()).toBe(true)
    expect(calls).toEqual([
      'sign in ann@example.test',
      'create acme',
      'invite beto@example.test to acme',
      'invite cleo@example.test to acme',
      'invite dani@example.test to acme',
      'sign in beto@example.test',
      'join as beto@example.test',
      'sign in dani@example.test',
      'join as dani@example.test',
    ])
  })

  it('stops at the first failure: an invite the gateway refuses leaves nobody to join', async () => {
    const { client, calls } = recordingClient()
    const refusing: SeedClient = {
      ...client,
      ensureInvited: () => errAsync(dataError('data:WRITE_REJECTED', 'not-admin')),
    }
    const outcome = await seedOrganisations(refusing, catalog, { kind: 'demo' })

    expect(outcome._unsafeUnwrapErr()).toMatchObject({ message: 'not-admin' })
    expect(calls).toEqual(['sign in ann@example.test', 'create acme'])
  })
})
