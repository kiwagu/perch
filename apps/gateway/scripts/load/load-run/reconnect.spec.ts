import { describe, expect, it } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

import { ClosedBeforeWelcome } from '../closed-before-welcome'

import { reconnect } from './reconnect'

const URL = 'ws://127.0.0.1:1/sync'

/** An open that rejects with each of `failures` in turn, then resolves with `welcome`. */
function opens(failures: readonly unknown[], welcome = 'welcome') {
  const calls: number[] = []

  return {
    calls,
    open: async (): Promise<string> => {
      const failure = failures[calls.length]

      calls.push(Date.now())

      if (failure !== undefined) throw failure

      return welcome
    },
  }
}

describe('reconnect', () => {
  it('waits the delay of each attempt and counts every rejected open as one failed hello', async () => {
    const asked: number[] = []
    const failed: unknown[] = []
    const refused = new Error('socket error')
    const closed = new ClosedBeforeWelcome(URL, 1006)
    const { open, calls } = opens([refused, closed])
    const outcome = await reconnect(open, {
      signal: new AbortController().signal,
      onFailed: (cause) => failed.push(cause),
      delay: (attempt) => {
        asked.push(attempt)

        return 1
      },
    })

    expect(outcome).toEqual({ kind: 'welcomed', value: 'welcome' })
    expect(asked).toEqual([0, 1, 2])
    expect(calls).toHaveLength(3)
    expect(failed).toEqual([refused, closed])
  })

  it('waits the delay of attempt 0 before its first open', async () => {
    const startedAt = Date.now()
    const { open, calls } = opens([])

    await reconnect(open, {
      signal: new AbortController().signal,
      onFailed: () => undefined,
      delay: () => 60,
    })

    expect((calls[0] ?? 0) - startedAt).toBeGreaterThanOrEqual(50)
  })

  it('stops for good on a close the gateway ends a device with, and counts no failed hello for it', async () => {
    const failed: unknown[] = []
    const { open, calls } = opens([
      new Error('socket error'),
      new ClosedBeforeWelcome(URL, CLOSE.revoked),
    ])
    const outcome = await reconnect(open, {
      signal: new AbortController().signal,
      onFailed: (cause) => failed.push(cause),
      delay: () => 1,
    })

    expect(outcome).toEqual({ kind: 'ended', reason: 'revoked' })
    expect(calls).toHaveLength(2)
    expect(failed).toHaveLength(1)
  })

  it('reconnects after a close the transport reconnects after, a hello timeout included', async () => {
    const { open } = opens([new ClosedBeforeWelcome(URL, 1001), new ClosedBeforeWelcome(URL, 4408)])
    const failed: unknown[] = []
    const outcome = await reconnect(open, {
      signal: new AbortController().signal,
      onFailed: (cause) => failed.push(cause),
      delay: () => 1,
    })

    expect(outcome.kind).toBe('welcomed')
    expect(failed).toHaveLength(2)
  })

  it('stops at its next wait once aborted by a failure, without another open', async () => {
    const controller = new AbortController()
    const { open, calls } = opens([new Error('refused')])
    const outcome = await reconnect(open, {
      signal: controller.signal,
      onFailed: () => controller.abort(),
      delay: (attempt) => (attempt === 0 ? 1 : 60_000),
    })

    expect(outcome).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(1)
  })

  it('cuts a wait short when it is aborted, and opens nothing', async () => {
    const controller = new AbortController()
    const { open, calls } = opens([])
    const loop = reconnect(open, {
      signal: controller.signal,
      onFailed: () => undefined,
      delay: () => 60_000,
    })

    setTimeout(() => controller.abort(), 10)

    expect(await loop).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(0)
  })

  it('opens nothing when it is already aborted', async () => {
    const { open, calls } = opens([])

    expect(
      await reconnect(open, {
        signal: AbortSignal.abort(),
        onFailed: () => undefined,
        delay: () => 1,
      }),
    ).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(0)
  })
})
