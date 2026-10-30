import { describe, expect, it, vi } from 'vitest'

import type { DataError } from '@workspace/data'

import { fakeFetch, noContent, respond } from '../__fixtures__/gateway-fetch'
import { gatewayAuth } from '../gateway-auth'
import {
  addPendingRevoke,
  type KeyValueStorage,
  memoryStorage,
  pendingRevokes,
  savedKeys,
  saveKeys,
} from '../storage'

import { PendingRevoke } from './pending-revoke'

/** A pair a sign-out left to revoke, with the device it signed out. */
const pair = { access: 'access-1', refresh: 'refresh-1', device: 'device-1' }

/** The pair of another account's sign-out on the same browser. */
const other = { access: 'access-2', refresh: 'refresh-2', device: 'device-1' }

const PENDING_KEY = 'perch.session.pending-revoke'

interface HarnessOptions {
  /** Throws from the storage's first read of the pair left to revoke. */
  readonly throwOnFirstRead?: boolean
  /** Throws from the error hook every time it is called. */
  readonly throwingHook?: boolean
  /** The pairs waiting when the test starts, oldest first; `pair` alone by default. */
  readonly waiting?: ReadonlyArray<typeof pair>
  /** The refresh key of a pair whose send throws before it reaches the gateway. */
  readonly throwingSendOf?: string
  /** Whether the browser says it has a network; it does by default. */
  readonly online?: boolean
}

/**
 * A pair left to revoke, sent over the gateway's auth to a fake `fetch` that answers with
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
  const auth = gatewayAuth('/backend', fetcher)
  const pending = new PendingRevoke({
    auth: {
      ...auth,
      signOut: (keys, device) => {
        if (keys.refresh === options.throwingSendOf) {
          throw new Error('the send broke')
        }

        return auth.signOut(keys, device)
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

  for (const waiting of options.waiting ?? [pair]) {
    addPendingRevoke(memory, waiting)
  }

  return { pending, memory, failures, sent, left: () => pendingRevokes(memory) }
}

describe('PendingRevoke', () => {
  it("forgets the device's keys, leaving keys that still work to revoke, sent at once online", async () => {
    const { pending, memory, sent, left } = harness([noContent()], { waiting: [] })

    saveKeys(memory, { access: 'access-3', refresh: 'refresh-3' })
    pending.forgetKeys('live')

    expect(savedKeys(memory)).toBeUndefined()
    // Sent unasked: the browser is online.
    await vi.waitFor(() => expect(left()).toEqual([]))
    expect(sent).toHaveLength(1)
  })

  it('keeps keys that still work to revoke later while the browser is offline', () => {
    const { pending, memory, sent, left } = harness([], { waiting: [], online: false })

    saveKeys(memory, { access: 'access-3', refresh: 'refresh-3' })
    pending.forgetKeys('live')

    expect(savedKeys(memory)).toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(left().map(({ refresh }) => refresh)).toEqual(['refresh-3'])
  })

  it('forgets dead keys without leaving them to revoke', () => {
    const { pending, memory, sent, left } = harness([], { waiting: [] })

    saveKeys(memory, { access: 'access-3', refresh: 'refresh-3' })
    pending.forgetKeys('dead')

    expect(savedKeys(memory)).toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(left()).toEqual([])
  })

  it('forgets the pair once the gateway revoked it (204) or refused it as dead (401)', async () => {
    for (const answer of [noContent(), respond(401, { code: 'unauthorized' })]) {
      const { pending, failures, sent, left } = harness([answer])

      await pending.send()

      expect(sent).toHaveLength(1)
      expect(left()).toEqual([])
      expect(failures).toEqual([])
    }
  })

  it('forgets a pair the gateway refuses with any other 4xx, which it will never take, and reports it', async () => {
    const { pending, failures, left } = harness([respond(400, { code: 'bad-request' })])

    await pending.send()

    expect(left()).toEqual([])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_REJECTED'])
  })

  it('keeps a pair the gateway asked to wait for (429) without reporting it, and sends it on the next pass', async () => {
    const { pending, failures, sent, left } = harness([
      respond(429, { code: 'rate-limited' }),
      noContent(),
    ])

    await pending.send()

    expect(left()).toEqual([pair])
    expect(failures).toEqual([])

    await pending.send()

    expect(sent).toHaveLength(2)
    expect(left()).toEqual([])
    expect(failures).toEqual([])
  })

  it('keeps the pair when the gateway failed (5xx), reporting it, and quietly while it is out of reach', async () => {
    const failing = harness([respond(503, { code: 'unavailable' })])

    await failing.pending.send()

    expect(failing.left()).toEqual([pair])
    expect(failing.failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])

    const offline = harness([() => Promise.reject(new TypeError('Failed to fetch'))])

    await offline.pending.send()

    expect(offline.left()).toEqual([pair])
    expect(offline.failures).toEqual([])
  })

  it('reports a send that throws, never to its caller, and the next send still runs', async () => {
    const { pending, failures, sent, left } = harness([noContent()], { throwOnFirstRead: true })

    await expect(pending.send()).resolves.toBeUndefined()
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sent).toEqual([])

    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(left()).toEqual([])
  })

  it("sends each pair kept with its own device, and forgets each on its own answer: another account's pair is not lost", async () => {
    const { pending, failures, sent, left } = harness(
      [respond(503, { code: 'unavailable' }), noContent()],
      { waiting: [pair, other] },
    )

    await pending.send()

    expect(sent.map((request) => [request.body, request.device])).toEqual([
      [{ access: pair.access, refresh: pair.refresh }, pair.device],
      [{ access: other.access, refresh: other.refresh }, other.device],
    ])
    // The first failed (kept, reported), the second was revoked (forgotten).
    expect(left()).toEqual([pair])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('keeps the pair the device holds after those kept before, and reports the oldest it drops past 8', () => {
    const waiting = Array.from({ length: 8 }, (_, n) => ({
      access: `access-w${n}`,
      refresh: `refresh-w${n}`,
      device: 'device-1',
    }))
    const { pending, memory, failures, left } = harness([], { waiting })

    saveKeys(memory, { access: 'access-now', refresh: 'refresh-now' })
    memory.set('perch.device.id', 'device-now')
    pending.keep()

    expect(left()).toEqual([
      ...waiting.slice(1),
      { access: 'access-now', refresh: 'refresh-now', device: 'device-now' },
    ])
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    // The report names no key.
    expect(JSON.stringify(failures)).not.toContain('refresh-w0')
  })

  it("sends the next pair in the same pass when one pair's send throws, or its report does: that pair stays", async () => {
    const throwing = harness([noContent()], {
      waiting: [pair, other],
      throwingSendOf: pair.refresh,
    })

    await expect(throwing.pending.send()).resolves.toBeUndefined()
    expect(throwing.sent.map((request) => request.body)).toEqual([
      { access: other.access, refresh: other.refresh },
    ])
    expect(throwing.left()).toEqual([pair])
    expect(throwing.failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(JSON.stringify(throwing.failures)).not.toContain(pair.refresh)

    const reporting = harness([respond(503, { code: 'unavailable' }), noContent()], {
      waiting: [pair, other],
      throwingHook: true,
    })

    await expect(reporting.pending.send()).resolves.toBeUndefined()
    expect(reporting.sent).toHaveLength(2)
    expect(reporting.left()).toEqual([pair])
  })

  it('leaves the next send to run when the error hook throws', async () => {
    const { pending, sent, left } = harness([respond(503, { code: 'unavailable' }), noContent()], {
      throwingHook: true,
    })

    await expect(pending.send()).resolves.toBeUndefined()
    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(2)
    expect(left()).toEqual([])
  })
})
