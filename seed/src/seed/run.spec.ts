import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import type {
  Inbox,
  Invited,
  OrganisationView,
  SeedClient,
  StandOptions,
} from '@workspace/web/seeding'

import { type Catalog, catalog } from '../catalog'

import { type CommandRunner, OPERATOR_CLI, spawnCommand } from './command-runner'
import { grantOperators, runSeed, seedOrganisations } from './run'

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

/** A command runner that records each command it is given, and answers `exit` for all of them. */
function recordingRunner(exit = 0) {
  const ran: (readonly string[])[] = []
  const runCommand: CommandRunner = (argv) => {
    ran.push(argv)

    return Promise.resolve(exit)
  }

  return { ran, runCommand }
}

describe('runSeed', () => {
  it("calls the gateway's routes through the fetcher it is given, signing in first", async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const { ran, runCommand } = recordingRunner()
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'demo' },
      inbox,
      runCommand,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual(['http://127.0.0.1:9/auth/sign-in/email'])
    expect(seeded._unsafeUnwrapErr().message).toBe('the gateway refused the request with 503')
    expect(asked).toEqual([])
    // No account was made, so nobody is appointed.
    expect(ran).toEqual([])
  })

  it('refuses a catalog the run would not hold before it sweeps or calls the gateway', async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const run = 'r'.repeat(40)
    const { ran, runCommand } = recordingRunner()
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'fresh', run },
      reset: true,
      inbox,
      runCommand,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual([])
    expect(asked).toEqual([])
    expect(ran).toEqual([])
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

/** A stand that is nothing like the default one: each setting of the command comes from here. */
const stand: StandOptions = {
  url: 'http://127.0.0.1:8010',
  namespace: 'platform',
  database: 'accounts',
  credentials: { username: 'operator', password: 'Seed-secret-9' },
}

/** The arguments `bun <cli> ... grant <email>` the seed gives the operator command for `stand`. */
const grantArguments = (email: string) => [
  'bun',
  OPERATOR_CLI,
  '--url=http://127.0.0.1:8010',
  '--namespace=platform',
  '--database=accounts',
  '--user=operator',
  '--pass=Seed-secret-9',
  'grant',
  email,
]

describe('grantOperators', () => {
  it("runs the operator command for the account the catalog marks, on the stand's own settings", async () => {
    const { ran, runCommand } = recordingRunner()

    expect((await grantOperators(runCommand, stand, catalog, { kind: 'demo' })).isOk()).toBe(true)
    expect(ran).toEqual([grantArguments('ann@example.test')])
  })

  it("names the account of a fresh run by the run's address", async () => {
    const { ran, runCommand } = recordingRunner()

    expect(
      (await grantOperators(runCommand, stand, catalog, { kind: 'fresh', run: 'r1' })).isOk(),
    ).toBe(true)
    expect(ran).toEqual([grantArguments('ann.r1@example.test')])
  })

  it('runs nothing when no account is marked, and one command each, in order, when several are', async () => {
    const none = recordingRunner()
    const unmarked: Catalog = {
      ...catalog,
      accounts: catalog.accounts.map(({ operator: _marked, ...preset }) => preset),
    }

    expect((await grantOperators(none.runCommand, stand, unmarked, { kind: 'demo' })).isOk()).toBe(
      true,
    )
    expect(none.ran).toEqual([])

    const several = recordingRunner()
    const marked: Catalog = {
      ...catalog,
      accounts: catalog.accounts.map((preset) => ({ ...preset, operator: true })),
    }

    expect((await grantOperators(several.runCommand, stand, marked, { kind: 'demo' })).isOk()).toBe(
      true,
    )
    expect(several.ran).toEqual([
      grantArguments('ann@example.test'),
      grantArguments('beto@example.test'),
    ])
  })

  it('fails on a non-zero exit, naming the exit code and the email and never the password', async () => {
    const { ran, runCommand } = recordingRunner(2)
    const outcome = await grantOperators(runCommand, stand, catalog, { kind: 'demo' })
    const failure = outcome._unsafeUnwrapErr()

    expect(failure.code).toBe('data:COMMAND_FAILED')
    expect(failure.message).toBe('the operator command exited with 2 for ann@example.test')
    expect(JSON.stringify(failure)).not.toContain('Seed-secret-9')
    expect(ran).toHaveLength(1)
  })

  it('stops at the first account the command fails for', async () => {
    const marked: Catalog = {
      ...catalog,
      accounts: catalog.accounts.map((preset) => ({ ...preset, operator: true })),
    }
    const { ran, runCommand } = recordingRunner(1)

    expect((await grantOperators(runCommand, stand, marked, { kind: 'demo' })).isErr()).toBe(true)
    expect(ran).toEqual([grantArguments('ann@example.test')])
  })

  it('fails when the command cannot be run, naming the email and never the password', async () => {
    const outcome = await grantOperators(
      () => Promise.reject(new Error('bun could not be started: ENOENT')),
      stand,
      catalog,
      { kind: 'demo' },
    )
    const failure = outcome._unsafeUnwrapErr()

    expect(failure.code).toBe('data:COMMAND_FAILED')
    expect(failure.message).toBe(
      'the operator command could not run for ann@example.test: bun could not be started: ENOENT',
    )
    expect(JSON.stringify(failure)).not.toContain('Seed-secret-9')
  })

  it("never carries the password out of the real runner's failure to start, which Node words with the arguments", async () => {
    // The NUL makes Node refuse the argument at once, and its message quotes that argument.
    const outcome = await grantOperators(
      spawnCommand,
      { ...stand, credentials: { username: 'operator', password: 'Seed-secret-9\0' } },
      catalog,
      { kind: 'demo' },
    )
    const failure = outcome._unsafeUnwrapErr()

    expect(failure.code).toBe('data:COMMAND_FAILED')
    expect(failure.message).toContain('ann@example.test')
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(
      'Seed-secret-9',
    )
    expect(String(failure)).not.toContain('Seed-secret-9')
  })
})
