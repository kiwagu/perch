import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import {
  MADE_AT,
  writeAccount,
  writeOrganisation,
  writeProfile,
  writeSession,
} from '../__fixtures__/accounts'
import {
  type Ask,
  type ConsoleAuth,
  closeConsoleAuth,
  consoleRequest,
  openConsoleAuth,
  setRole,
  signedUp,
} from '../__fixtures__/operators'
import { AccountDirectory } from '../account-directory'

import { consoleRoutes } from './routes'

afterEach(closeConsoleAuth)

const DAY_MS = 24 * 60 * 60 * 1000

/** The instant `days` days after the accounts written here were made. */
const day = (days: number): Date => new Date(MADE_AT.getTime() + days * DAY_MS)

/** The client address every request comes from. */
const ADDRESS = '203.0.113.1'

/** A route's answer: its status, its JSON body (none when empty) and its headers. */
async function answered(response: Response | undefined) {
  if (response === undefined) {
    return expect.unreachable('the routes answered nothing')
  }

  const text = await response.text()

  return {
    status: response.status,
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
    headers: response.headers,
  }
}

/**
 * The console's routes over an in-memory directory, with an operator (ann) and an account that is
 * none (bob) signed up; the accounts are read through `accounts`, which records each read.
 */
async function served(
  options: {
    readonly accounts?: (real: AccountDirectory) => Pick<AccountDirectory, 'list' | 'read'>
    readonly sessions?: (auth: ConsoleAuth) => Pick<ConsoleAuth['sessions'], 'read'>
  } = {},
) {
  const auth = await openConsoleAuth()
  const failures: DataError[] = []
  const reads: string[] = []
  const real = new AccountDirectory(auth.local)
  const directory = options.accounts?.(real) ?? real
  const routes = consoleRoutes({
    sessions: options.sessions?.(auth) ?? auth.sessions,
    accounts: {
      list: (search) => {
        reads.push('list')

        return directory.list(search)
      },
      read: (identity) => {
        reads.push('read')

        return directory.read(identity)
      },
    },
    onFailure: (error) => failures.push(error),
  })
  const ann = await signedUp(auth, 'ann@example.test', { role: 'operator', name: 'Ann' })
  const bob = await signedUp(auth, 'bob@example.test', { name: 'Bob' })
  const ask = async (method: string, path: string, by: Ask = { as: ann }) =>
    answered(await routes(consoleRequest(method, path, by), ADDRESS))

  return { auth, routes, ann, bob, ask, failures, reads }
}

describe('consoleRoutes: GET /console/accounts', () => {
  it('answers an operator the page of accounts its search finds, with what the list shows of each and their number', async () => {
    const { auth, ask } = await served()
    const cat = await writeAccount(auth.local, {
      email: 'cat@listed.test',
      name: 'Cat',
      createdAt: day(1),
      emailVerified: true,
      banned: true,
      banReason: 'spam',
      role: 'operator',
    })
    const dan = await writeAccount(auth.local, { email: 'dan@listed.test', name: 'Dan' })

    await writeProfile(auth.local, dan, 'Daniel Quill')

    const { status, body } = await ask('GET', '/console/accounts?q=LISTED&page=1&size=10')

    expect({ status, body }).toEqual({
      status: 200,
      body: {
        accounts: [
          {
            id: cat,
            name: 'Cat',
            email: 'cat@listed.test',
            emailVerified: true,
            banned: true,
            operator: true,
            createdAt: day(1).toISOString(),
          },
          {
            id: dan,
            name: 'Daniel Quill',
            email: 'dan@listed.test',
            emailVerified: false,
            banned: false,
            operator: false,
            createdAt: MADE_AT.toISOString(),
          },
        ],
        total: 2,
      },
    })
  })

  it('carries nothing of an account but what the list shows: no ban reason', async () => {
    const { auth, ask } = await served()

    const cat = await writeAccount(auth.local, {
      email: 'cat@listed.test',
      banned: true,
      banReason: 'spam',
    })
    const { body } = await ask('GET', '/console/accounts?q=listed')

    expect(body).toEqual({
      accounts: [
        {
          id: cat,
          name: 'Ann',
          email: 'cat@listed.test',
          emailVerified: false,
          banned: true,
          operator: false,
          createdAt: MADE_AT.toISOString(),
        },
      ],
      total: 1,
    })
  })

  it('reads page 1 of 25 accounts when the query names no page or size, and the page and size it names', async () => {
    const { auth, ask } = await served()

    for (let index = 0; index < 30; index += 1) {
      await writeAccount(auth.local, { email: `user${index}@listed.test`, createdAt: day(-index) })
    }

    const page = async (query: string) => {
      const { status, body } = await ask('GET', `/console/accounts${query}`)

      return { status, body: body as { accounts: unknown[]; total: number } }
    }

    // The two accounts signed up here are the newest: the 30 written were made before them.
    expect(await page('')).toMatchObject({ status: 200, body: { total: 32 } })
    expect((await page('')).body.accounts).toHaveLength(25)
    expect((await page('?page=2')).body.accounts).toHaveLength(7)
    expect((await page('?size=10&page=4')).body.accounts).toHaveLength(2)
    expect((await page('?size=50')).body.accounts).toHaveLength(32)
    expect((await page('?q=')).body.total).toBe(32)
  })

  it('answers a page past the last with no account and the number of them all', async () => {
    const { ask } = await served()

    expect(await ask('GET', '/console/accounts?page=3&size=10')).toMatchObject({
      status: 200,
      body: { accounts: [], total: 2 },
    })
    expect(
      await ask('GET', `/console/accounts?page=${Number.MAX_SAFE_INTEGER}&size=50`),
    ).toMatchObject({ status: 200, body: { accounts: [], total: 2 } })
  })

  it('answers 400 bad-request to a query that does not follow its schema, and reads nothing', async () => {
    const { ask, reads } = await served()

    for (const query of [
      'page=0',
      'page=-1',
      'page=1.5',
      'page=01',
      'page=abc',
      'page=',
      `page=${Number.MAX_SAFE_INTEGER + 1}`,
      'size=20',
      'size=0',
      'size=',
      'size=1e1',
      `q=${'a'.repeat(255)}`,
      'page=1&page=2',
      'q=ann&q=bob',
      'sort=email',
    ]) {
      expect({ query, ...(await ask('GET', `/console/accounts?${query}`)) }).toMatchObject({
        query,
        status: 400,
        body: { code: 'bad-request' },
      })
    }

    expect(reads).toEqual([])
  })
})

describe('consoleRoutes: GET /console/accounts/:id', () => {
  it("answers an operator the account's card: its marks, its ban's reason, its last seen device and its organisations", async () => {
    const { auth, ask } = await served()
    const cat = await writeAccount(auth.local, {
      email: 'cat@listed.test',
      name: 'Cat Signup',
      emailVerified: true,
      banned: true,
      banReason: 'spam',
      role: 'operator',
    })

    await writeProfile(auth.local, cat, 'Cat Stevens')
    await writeSession(auth.local, cat, { lastSeenAt: day(4), endedAt: day(4) })
    await writeOrganisation(auth.local, cat, { key: 'acme', name: 'Acme', role: 'admin' })

    const { status, body } = await ask('GET', `/console/accounts/${cat}`)

    expect({ status, body }).toEqual({
      status: 200,
      body: {
        account: {
          id: cat,
          name: 'Cat Stevens',
          email: 'cat@listed.test',
          emailVerified: true,
          createdAt: MADE_AT.toISOString(),
          hasProfile: true,
          lastSeenAt: day(4).toISOString(),
          operator: true,
          banned: true,
          banReason: 'spam',
          organisations: [{ key: 'acme', name: 'Acme', role: 'admin' }],
        },
      },
    })
  })

  it('answers null for a last seen and a ban reason an account does not have', async () => {
    const { auth, ask } = await served()
    const dan = await writeAccount(auth.local, { email: 'dan@listed.test', name: 'Dan' })

    expect((await ask('GET', `/console/accounts/${dan}`)).body).toEqual({
      account: {
        id: dan,
        name: 'Dan',
        email: 'dan@listed.test',
        emailVerified: false,
        createdAt: MADE_AT.toISOString(),
        hasProfile: false,
        lastSeenAt: null,
        operator: false,
        banned: false,
        banReason: null,
        organisations: [],
      },
    })
  })

  it('answers 404 account-gone for an id no account has, of the form of an id or not', async () => {
    const { ask } = await served()

    for (const id of [identityIdFactory.create(), 'nonsense', 'idn_']) {
      expect(await ask('GET', `/console/accounts/${id}`)).toMatchObject({
        status: 404,
        body: { code: 'account-gone' },
      })
    }
  })
})

describe('consoleRoutes: the operator gate', () => {
  it('refuses an account that is no operator 403 not-operator at every path, and reads no account for it', async () => {
    const { ask, ann, bob, reads } = await served()

    for (const path of [
      '/console/accounts',
      '/console/accounts?page=0',
      `/console/accounts/${ann.identity}`,
      '/console/accounts/nonsense',
    ]) {
      expect(await ask('GET', path, { as: bob })).toMatchObject({
        status: 403,
        body: { code: 'not-operator' },
      })
    }

    expect(await ask('POST', '/console/accounts', { as: bob })).toMatchObject({ status: 403 })
    expect(reads).toEqual([])
  })

  it('answers 401 without a live session and 400 without a valid device, reading no account', async () => {
    const { ask, ann, reads } = await served()
    const unsigned = await ask('GET', '/console/accounts', { device: ann.device })

    expect(unsigned).toMatchObject({ status: 401, body: { code: 'unauthorized' } })
    expect(unsigned.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(
      await ask('GET', `/console/accounts/${ann.identity}`, { as: ann, token: 'nonsense' }),
    ).toMatchObject({ status: 401 })
    expect(await ask('GET', '/console/accounts', { as: ann, device: null })).toMatchObject({
      status: 400,
      body: { code: 'bad-request' },
    })
    expect(reads).toEqual([])
  })

  it('refuses an operator whose role was taken back at its next request', async () => {
    const { auth, ask, ann } = await served()

    expect(await ask('GET', '/console/accounts')).toMatchObject({ status: 200 })

    await setRole(auth, ann.identity, 'user')

    expect(await ask('GET', '/console/accounts')).toMatchObject({
      status: 403,
      body: { code: 'not-operator' },
    })
  })
})

describe('consoleRoutes: paths and methods', () => {
  it('answers 405 with the method a path takes in Allow', async () => {
    const { ask, ann } = await served()

    for (const [method, path] of [
      ['POST', '/console/accounts'],
      ['DELETE', `/console/accounts/${ann.identity}`],
    ] as const) {
      const { status, body, headers } = await ask(method, path)

      expect({ status, body, allow: headers.get('Allow') }).toEqual({
        status: 405,
        body: { code: 'method-not-allowed' },
        allow: 'GET',
      })
    }
  })

  it('answers no other path, so the server tries its other routes', async () => {
    const { routes, ann } = await served()

    for (const path of [
      '/console',
      '/console/accounts/',
      `/console/accounts/${ann.identity}/ban`,
      '/console/accountsx',
      '/console/users',
    ]) {
      expect(await routes(consoleRequest('GET', path, { as: ann }), ADDRESS)).toBeUndefined()
    }
  })
})

describe('consoleRoutes: failures', () => {
  it('answers 500 internal to a failure of the directory, which onFailure hears', async () => {
    const error = dataError('data:QUERY_FAILED', 'the directory is gone')
    const { ask, ann, failures } = await served({
      accounts: () => ({ list: () => errAsync(error), read: () => errAsync(error) }),
    })

    expect(await ask('GET', '/console/accounts')).toMatchObject({
      status: 500,
      body: { code: 'internal' },
    })
    expect(await ask('GET', `/console/accounts/${ann.identity}`)).toMatchObject({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0)).toEqual([error, error])
  })

  it('answers 500 internal to a session that could not be read, which onFailure hears', async () => {
    const error = dataError('data:QUERY_FAILED', 'the sessions are gone')
    const { ask, failures, reads } = await served({
      sessions: () => ({ read: async () => ({ kind: 'failed', error }) as const }),
    })

    expect(await ask('GET', '/console/accounts')).toMatchObject({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0)).toEqual([error])
    expect(reads).toEqual([])
  })
})
