import { errAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond } from '../__fixtures__/gateway-fetch'
import { gatewayAuth } from '../gateway-auth'
import {
  addPendingRevoke,
  browserStorage,
  deviceIdFrom,
  type KeyValueStorage,
  memoryStorage,
  pendingRevokes,
  savedToken,
  TOKEN_KEY,
  tokenRecord,
} from '../storage'

import { PendingRevoke } from './pending-revoke'

/** Whose the device's token is: no call here reads it for its identity. */
const owner = identityIdFactory.create()

/** A token a sign-out left to sign out, with the device it signed out. */
const left = { token: 'token-1', device: 'device-1' }

/** The token of another account's sign-out on the same browser. */
const other = { token: 'token-2', device: 'device-1' }

const PENDING_KEY = 'perch.session.pending-revoke'

interface HarnessOptions {
  /** Throws from the storage's first read of the tokens left to sign out. */
  readonly throwOnFirstRead?: boolean
  /** Throws from the error hook every time it is called. */
  readonly throwingHook?: boolean
  /** The tokens waiting when the test starts, oldest first; `left` alone by default. */
  readonly waiting?: ReadonlyArray<typeof left>
  /** A token whose send throws before it reaches the gateway. */
  readonly throwingSendOf?: string
  /** Whether the browser says it has a network; it does by default. */
  readonly online?: boolean
  /** Answers every sign-out in place of the gateway. */
  readonly signOut?: (token: string) => ResultAsync<void, DataError>
}

/**
 * A token left to sign out, sent over the gateway's auth to a fake `fetch` that answers with
 * `answers` in turn; failures reported through the error hook are kept.
 */
function harness(answers: Array<() => Promise<Response>>, options: HarnessOptions = {}) {
  const memory = memoryStorage()
  let failNextRead = options.throwOnFirstRead ?? false
  const storage: KeyValueStorage = {
    get: (key) => {
      if (failNextRead && key === PENDING_KEY) {
        failNextRead = false
        throw new Error('the storage is gone')
      }

      return memory.get(key)
    },
    set: (key, value) => memory.set(key, value),
    remove: (key) => memory.remove(key),
    onChangeElsewhere: (listener) => memory.onChangeElsewhere(listener),
  }
  const failures: DataError[] = []
  const { fetcher, sent } = fakeFetch(...answers)
  const auth = gatewayAuth('https://app.example.test/backend', fetcher)
  const pending = new PendingRevoke({
    auth: {
      ...auth,
      signOut: (token, device) => {
        if (token === options.throwingSendOf) {
          throw new Error('the send broke')
        }

        return options.signOut ? options.signOut(token) : auth.signOut(token, device)
      },
    },
    storage,
    online: () => options.online ?? true,
    onError: (error) => {
      failures.push(error)

      if (options.throwingHook) {
        throw new Error('the error hook failed')
      }
    },
  })

  for (const waiting of options.waiting ?? [left]) {
    addPendingRevoke(memory, waiting)
  }

  return { pending, memory, failures, sent, waiting: () => pendingRevokes(memory) }
}

describe('PendingRevoke', () => {
  it("forgets the device's token, leaving a token that still works to sign out, sent at once online", async () => {
    const { pending, memory, sent, waiting } = harness([noContent()], { waiting: [] })

    memory.set(TOKEN_KEY, tokenRecord(owner, 'token-3'))
    pending.forgetKeys('live')

    expect(savedToken(memory)).toBeUndefined()
    // Sent unasked: the browser is online.
    await vi.waitFor(() => expect(waiting()).toEqual([]))
    expect(sent.map(({ url, authorization }) => [url, authorization])).toEqual([
      ['https://app.example.test/backend/auth/sign-out', 'Bearer token-3'],
    ])
  })

  it('keeps a token that still works to sign out later while the browser is offline', () => {
    const { pending, memory, sent, waiting } = harness([], { waiting: [], online: false })

    memory.set(TOKEN_KEY, tokenRecord(owner, 'token-3'))
    pending.forgetKeys('live')

    expect(savedToken(memory)).toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(waiting().map(({ token }) => token)).toEqual(['token-3'])
  })

  it('forgets a dead token without leaving it to sign out', () => {
    const { pending, memory, sent, waiting } = harness([], { waiting: [] })

    memory.set(TOKEN_KEY, tokenRecord(owner, 'token-3'))
    pending.forgetKeys('dead')

    expect(savedToken(memory)).toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(waiting()).toEqual([])
  })

  it('keeps a token left to sign out online in storage while its send is in flight, and forgets it once signed out (204)', async () => {
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const { pending, memory, sent, waiting } = harness(
      [() => answered.then(() => new Response(null, { status: 204 }))],
      { waiting: [] },
    )

    pending.leave('token-4')

    const kept = { token: 'token-4', device: deviceIdFrom(memory) }

    // Kept before the gateway is asked: a page closed meanwhile leaves it for the next start.
    expect(waiting()).toEqual([kept])
    await vi.waitFor(() =>
      expect(sent.map(({ authorization }) => authorization)).toEqual(['Bearer token-4']),
    )
    expect(waiting()).toEqual([kept])

    answer()

    await vi.waitFor(() => expect(waiting()).toEqual([]))
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['failed (5xx), which is reported', respond(503, { code: 'unavailable' }), 'data:WRITE_FAILED'],
    ['is out of reach, quietly', () => Promise.reject(new TypeError('Failed to fetch')), undefined],
  ] as const)(
    'keeps a token left to sign out online in storage when the gateway %s, for the next send',
    async (_, answer, reported) => {
      const { pending, memory, failures, sent, waiting } = harness([answer], { waiting: [] })

      pending.leave('token-4')
      // Runs once the token's own send answered, and sends it again.
      await pending.send()

      expect(sent.map(({ authorization }) => authorization)).toEqual([
        'Bearer token-4',
        'Bearer token-4',
      ])
      expect(waiting()).toEqual([{ token: 'token-4', device: deviceIdFrom(memory) }])
      expect(failures.map((failure) => failure.code)).toEqual(reported ? [reported, reported] : [])
    },
  )

  it('forgets the token once the gateway signed it out (204) or refused it as dead (401)', async () => {
    for (const answer of [noContent(), respond(401, { code: 'unauthorized' })]) {
      const { pending, failures, sent, waiting } = harness([answer])

      await pending.send()

      expect(sent).toHaveLength(1)
      expect(waiting()).toEqual([])
      expect(failures).toEqual([])
    }
  })

  it('forgets a token the gateway refuses with any other 4xx, which it will never take, and reports it', async () => {
    const { pending, failures, waiting } = harness([respond(400, { code: 'bad-request' })])

    await pending.send()

    expect(waiting()).toEqual([])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_REJECTED'])
  })

  it('keeps a token the gateway asked to wait for (429) without reporting it, and sends it on the next pass', async () => {
    const { pending, failures, sent, waiting } = harness([
      respond(429, { code: 'rate-limited' }),
      noContent(),
    ])

    await pending.send()

    expect(waiting()).toEqual([left])
    expect(failures).toEqual([])

    await pending.send()

    expect(sent).toHaveLength(2)
    expect(waiting()).toEqual([])
    expect(failures).toEqual([])
  })

  it('keeps the token when the gateway failed (5xx), reporting it, and quietly while it is out of reach', async () => {
    const failing = harness([respond(503, { code: 'unavailable' })])

    await failing.pending.send()

    expect(failing.waiting()).toEqual([left])
    expect(failing.failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])

    const offline = harness([() => Promise.reject(new TypeError('Failed to fetch'))])

    await offline.pending.send()

    expect(offline.waiting()).toEqual([left])
    expect(offline.failures).toEqual([])
  })

  it('reports a send that throws, never to its caller, and the next send still runs', async () => {
    const { pending, failures, sent, waiting } = harness([noContent()], { throwOnFirstRead: true })

    await expect(pending.send()).resolves.toBeUndefined()
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sent).toEqual([])

    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(waiting()).toEqual([])
  })

  it("sends each token kept with its own device, and forgets each on its own answer: another account's token is not lost", async () => {
    const { pending, failures, sent, waiting } = harness(
      [respond(503, { code: 'unavailable' }), noContent()],
      { waiting: [left, other] },
    )

    await pending.send()

    expect(sent.map((request) => [request.authorization, request.device])).toEqual([
      [`Bearer ${left.token}`, left.device],
      [`Bearer ${other.token}`, other.device],
    ])
    // The first failed (kept, reported), the second was revoked (forgotten).
    expect(waiting()).toEqual([left])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('keeps the token the device holds after those kept before, and reports the oldest it drops past 8', () => {
    const kept = Array.from({ length: 8 }, (_, n) => ({ token: `token-w${n}`, device: 'device-1' }))
    const { pending, memory, failures, waiting } = harness([], { waiting: kept })

    memory.set(TOKEN_KEY, tokenRecord(owner, 'token-now'))
    memory.set('perch.device.id', 'device-now')
    pending.keep()

    expect(waiting()).toEqual([...kept.slice(1), { token: 'token-now', device: 'device-now' }])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    // The report names no token.
    expect(JSON.stringify(failures)).not.toContain('token-w0')
  })

  it("sends the next token in the same pass when one token's send throws, or its report does: that token stays", async () => {
    const throwing = harness([noContent()], {
      waiting: [left, other],
      throwingSendOf: left.token,
    })

    await expect(throwing.pending.send()).resolves.toBeUndefined()
    expect(throwing.sent.map((request) => request.authorization)).toEqual([`Bearer ${other.token}`])
    expect(throwing.waiting()).toEqual([left])
    expect(throwing.failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(JSON.stringify(throwing.failures)).not.toContain(left.token)

    const reporting = harness([respond(503, { code: 'unavailable' }), noContent()], {
      waiting: [left, other],
      throwingHook: true,
    })

    await expect(reporting.pending.send()).resolves.toBeUndefined()
    expect(reporting.sent).toHaveLength(2)
    expect(reporting.waiting()).toEqual([left])
  })

  it('leaves the next send to run when the error hook throws', async () => {
    const { pending, sent, waiting } = harness(
      [respond(503, { code: 'unavailable' }), noContent()],
      {
        throwingHook: true,
      },
    )

    await expect(pending.send()).resolves.toBeUndefined()
    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(2)
    expect(waiting()).toEqual([])
  })

  it.each([
    [
      'a send that throws',
      (token: string): ResultAsync<void, DataError> => {
        throw new Error(`the send broke with ${token}`)
      },
    ],
    [
      'a send whose promise rejects',
      (token: string) =>
        new ResultAsync<void, DataError>(Promise.reject(new Error(`the send broke with ${token}`))),
    ],
    [
      'a gateway that failed',
      (token: string) =>
        errAsync(
          dataError(
            'data:WRITE_FAILED',
            `could not sign ${token} out`,
            new Error(`the gateway broke with ${token}`),
          ),
        ),
    ],
    [
      'a gateway that refused',
      (token: string) =>
        errAsync(
          dataError(
            'data:WRITE_REJECTED',
            `refused ${token}`,
            new Error(`the gateway refused ${token}`),
          ),
        ),
    ],
  ] as const)(
    'reports %s by its code and message only: no cause, and nothing of the token',
    async (_, signOut) => {
      // A token kept to sign out, then one left to sign out online, sent on its own.
      const { pending, failures } = harness([], { signOut })

      await pending.send()
      pending.leave('token-5')
      await pending.send()

      expect(failures.length).toBeGreaterThan(0)

      for (const failure of failures) {
        expect(failure).not.toHaveProperty('cause')
        expect(failure.message).not.toContain(left.token)
        expect(failure.message).not.toContain('token-5')
      }
    },
  )
})

/** The browser's `localStorage` once its quota is full: it reads, and refuses every write. */
function fullStorage(values: Readonly<Record<string, string>>): Storage {
  const kept = new Map(Object.entries(values))

  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key) => kept.get(key) ?? null,
    key: (index) => [...kept.keys()][index] ?? null,
    removeItem: (key) => {
      kept.delete(key)
    },
    setItem: () => {
      throw new DOMException('the quota is exceeded', 'QuotaExceededError')
    },
  }
}

/** A page that hears nothing of the other tabs. */
const noEvents = { addEventListener: () => {}, removeEventListener: () => {} }

describe('PendingRevoke over the browser storage, its quota full', () => {
  const unkept = {
    code: 'data:WRITE_FAILED',
    message: 'a token could not be kept for revocation on this browser',
  }

  /**
   * Tokens left to sign out on a browser whose storage refuses every write (the adapter drops the
   * refusal), sent to a fake `fetch` answering `answers` in turn while `network.online`.
   */
  function onFullStorage(
    answers: Array<() => Promise<Response>>,
    network: { online: boolean },
    values: Readonly<Record<string, string>> = {},
  ) {
    const storage = browserStorage(
      fullStorage({ 'perch.device.id': 'device-1', ...values }),
      noEvents,
    )
    const failures: DataError[] = []
    const { fetcher, sent } = fakeFetch(...answers)
    const pending = new PendingRevoke({
      auth: gatewayAuth('https://app.example.test/backend', fetcher),
      storage,
      online: () => network.online,
      onError: (error) => failures.push(error),
    })
    const signedOut = () => sent.map(({ authorization, device }) => [authorization, device])

    return { pending, failures, signedOut }
  }

  it('holds a token left to sign out online in memory, reports it naming no token, sends it at once and forgets it once signed out', async () => {
    const { pending, failures, signedOut } = onFullStorage([noContent()], { online: true })

    pending.leave('token-9')

    // Held, and reported, before the gateway is asked.
    expect(failures).toEqual([unkept])

    await pending.send()

    expect(signedOut()).toEqual([['Bearer token-9', 'device-1']])

    // Signed out, it is forgotten: the next send asks nothing.
    await pending.send()

    expect(signedOut()).toHaveLength(1)
    expect(failures).toEqual([unkept])
  })

  it('holds a token left to sign out offline in memory, reports it naming no token, and sends it once online', async () => {
    const network = { online: false }
    const { pending, failures, signedOut } = onFullStorage([noContent()], network)

    pending.leave('token-9')

    expect(signedOut()).toEqual([])
    expect(failures).toEqual([unkept])

    network.online = true
    await pending.send()

    expect(signedOut()).toEqual([['Bearer token-9', 'device-1']])

    // Signed out, it is forgotten: the next send asks nothing.
    await pending.send()

    expect(signedOut()).toHaveLength(1)
    expect(failures).toEqual([unkept])
  })

  it('holds in memory a token the gateway did not take, and sends it again on the next send', async () => {
    const { pending, failures, signedOut } = onFullStorage(
      [() => Promise.reject(new TypeError('Failed to fetch')), noContent()],
      { online: true },
    )

    pending.leave('token-9')
    // Runs once the token's own send answered, and sends it again.
    await pending.send()

    expect(signedOut()).toEqual([
      ['Bearer token-9', 'device-1'],
      ['Bearer token-9', 'device-1'],
    ])

    await pending.send()

    expect(signedOut()).toHaveLength(2)
    // Held once, reported once; the unreachable gateway is not reported.
    expect(failures).toEqual([unkept])
  })

  it("holds in memory the device's own token a sign-out leaves live, and sends it", async () => {
    const { pending, failures, signedOut } = onFullStorage(
      [noContent()],
      { online: true },
      {
        [TOKEN_KEY]: tokenRecord(owner, 'token-8'),
      },
    )

    pending.forgetKeys('live')
    await pending.send()

    expect(signedOut()).toEqual([['Bearer token-8', 'device-1']])
    expect(failures).toEqual([unkept])
  })
})
