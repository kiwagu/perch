import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'

import { fakeFetch, noContent, respond } from './__fixtures__/gateway-fetch'
import { gatewayAuth } from './gateway-auth'
import { PendingRevoke } from './pending-revoke'
import { type KeyValueStorage, memoryStorage, pendingRevoke, savePendingRevoke } from './storage'

const pair = { access: 'access-1', refresh: 'refresh-1' }

const PENDING_KEY = 'perch.session.pending-revoke'

interface HarnessOptions {
  /** Throws from the storage's first read of the pair left to revoke. */
  readonly throwOnFirstRead?: boolean
  /** Throws from the error hook every time it is called. */
  readonly throwingHook?: boolean
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
  const pending = new PendingRevoke({
    auth: gatewayAuth('/backend', fetcher),
    storage,
    onError: (error) => {
      failures.push(error)

      if (options.throwingHook) {
        throw new Error('the error hook failed')
      }
    },
  })

  savePendingRevoke(memory, pair)

  return { pending, failures, sent, left: () => pendingRevoke(memory) }
}

describe('PendingRevoke', () => {
  it('forgets the pair once the gateway revoked it (204) or refused it as dead (401)', async () => {
    for (const answer of [noContent(), respond(401, { code: 'unauthorized' })]) {
      const { pending, failures, sent, left } = harness([answer])

      await pending.send()

      expect(sent).toHaveLength(1)
      expect(left()).toBeUndefined()
      expect(failures).toEqual([])
    }
  })

  it('forgets a pair the gateway refuses with any other 4xx, which it will never take, and reports it', async () => {
    const { pending, failures, left } = harness([respond(400, { code: 'bad-request' })])

    await pending.send()

    expect(left()).toBeUndefined()
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_REJECTED'])
  })

  it('keeps the pair when the gateway failed (5xx), reporting it, and quietly while it is out of reach', async () => {
    const failing = harness([respond(503, { code: 'unavailable' })])

    await failing.pending.send()

    expect(failing.left()).toEqual(pair)
    expect(failing.failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])

    const offline = harness([() => Promise.reject(new TypeError('Failed to fetch'))])

    await offline.pending.send()

    expect(offline.left()).toEqual(pair)
    expect(offline.failures).toEqual([])
  })

  it('reports a send that throws, never to its caller, and the next send still runs', async () => {
    const { pending, failures, sent, left } = harness([noContent()], { throwOnFirstRead: true })

    await expect(pending.send()).resolves.toBeUndefined()
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sent).toEqual([])

    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(left()).toBeUndefined()
  })

  it('leaves the next send to run when the error hook throws', async () => {
    const { pending, sent, left } = harness([respond(503, { code: 'unavailable' }), noContent()], {
      throwingHook: true,
    })

    await expect(pending.send()).resolves.toBeUndefined()
    await expect(pending.send()).resolves.toBeUndefined()
    expect(sent).toHaveLength(2)
    expect(left()).toBeUndefined()
  })
})
