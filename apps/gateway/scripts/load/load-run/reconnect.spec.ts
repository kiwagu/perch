import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'
import { reconnectDelay } from '@workspace/replica/sync'

import { ClosedBeforeWelcome } from '../closed-before-welcome'

import { type ReconnectOptions, reconnect } from './reconnect'

// The loop's default delay is the replica's own `reconnectDelay`, drawn from `Math.random`:
// whatever it answers, the loop waits it, which a stand-in with a schedule of its own shows.
vi.mock('@workspace/replica/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@workspace/replica/sync')>()),
  reconnectDelay: vi.fn((attempt: number, _random: () => number) => 7 * (attempt + 1)),
}))

const URL = 'ws://127.0.0.1:1/sync'

interface Device {
  readonly close: () => void
}

/** What `open` resolves with: a device that counts its closes. */
function device(): { readonly close: Mock<() => void> } {
  return { close: vi.fn<() => void>() }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

/** An open that rejects with each of `failures` in turn, then resolves with a device. */
function opens(failures: readonly unknown[]) {
  const calls: number[] = []
  const signals: AbortSignal[] = []
  const welcomed = device()

  return {
    calls,
    signals,
    welcomed,
    open: async (signal: AbortSignal): Promise<Device> => {
      const failure = failures[calls.length]

      calls.push(Date.now())
      signals.push(signal)

      if (failure !== undefined) throw failure

      return welcomed
    },
  }
}

/** Starts a loop that no deadline, delay or abort cuts short unless the test says. */
function loop(open: (signal: AbortSignal) => Promise<Device>, options: Partial<ReconnectOptions>) {
  const controller = new AbortController()
  const failed: unknown[] = []
  const done = reconnect(open, {
    signal: controller.signal,
    until: Number.POSITIVE_INFINITY,
    onFailed: (cause) => failed.push(cause),
    delay: () => 1,
    ...options,
  })

  return { controller, failed, done }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('reconnect', () => {
  it('waits the delay of each attempt and counts every rejected open as one failed hello', async () => {
    const startedAt = Date.now()
    const asked: number[] = []
    const refused = new Error('socket error')
    const closed = new ClosedBeforeWelcome(URL, 1006)
    const { open, calls, welcomed } = opens([refused, closed])
    const { failed, done } = loop(open, {
      delay: (attempt) => {
        asked.push(attempt)

        return 10 * (attempt + 1)
      },
      now: () => 5,
    })

    await vi.advanceTimersByTimeAsync(60)

    expect(await done).toEqual({ kind: 'welcomed', value: welcomed, at: 5 })
    expect(asked).toEqual([0, 1, 2])
    expect(calls.map((at) => at - startedAt)).toEqual([10, 30, 60])
    expect(failed).toEqual([refused, closed])
  })

  it('waits the delay of the replica, drawn from Math.random, when it is given none', async () => {
    vi.mocked(reconnectDelay).mockClear()

    const startedAt = Date.now()
    const { open, calls } = opens([new Error('refused')])
    const done = reconnect(open, {
      signal: new AbortController().signal,
      until: Number.POSITIVE_INFINITY,
      onFailed: () => undefined,
    })

    await vi.advanceTimersByTimeAsync(7 + 14)
    await done

    expect(calls.map((at) => at - startedAt)).toEqual([7, 21])
    expect(vi.mocked(reconnectDelay).mock.calls).toEqual([
      [0, Math.random],
      [1, Math.random],
    ])
  })

  it('stops for good on a close the gateway ends a device with, and counts no failed hello for it', async () => {
    const { open, calls } = opens([
      new Error('socket error'),
      new ClosedBeforeWelcome(URL, CLOSE.revoked),
    ])
    const { failed, done } = loop(open, {})

    await vi.advanceTimersByTimeAsync(10)

    expect(await done).toEqual({ kind: 'ended', reason: 'revoked' })
    expect(calls).toHaveLength(2)
    expect(failed).toHaveLength(1)
  })

  it('reconnects after a close the transport reconnects after, a hello timeout included', async () => {
    const { open } = opens([new ClosedBeforeWelcome(URL, 1001), new ClosedBeforeWelcome(URL, 4408)])
    const { failed, done } = loop(open, {})

    await vi.advanceTimersByTimeAsync(10)

    expect((await done).kind).toBe('welcomed')
    expect(failed).toHaveLength(2)
  })

  it('opens nothing when it is aborted during a wait', async () => {
    const { open, calls } = opens([])
    const { controller, done } = loop(open, { delay: () => 60_000 })

    await vi.advanceTimersByTimeAsync(10)
    controller.abort()

    expect(await done).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(0)
  })

  it('opens nothing when it is already aborted', async () => {
    const { open, calls } = opens([])
    const { done } = loop(open, { signal: AbortSignal.abort() })

    expect(await done).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(0)
  })

  it('stops at its next wait once a failure aborted it, without another open', async () => {
    const controller = new AbortController()
    const { open, calls } = opens([new Error('refused')])
    const { done } = loop(open, {
      signal: controller.signal,
      onFailed: () => controller.abort(),
      delay: (attempt) => (attempt === 0 ? 1 : 60_000),
    })

    await vi.advanceTimersByTimeAsync(1)

    expect(await done).toEqual({ kind: 'stopped' })
    expect(calls).toHaveLength(1)
  })

  describe('at the deadline', () => {
    it('cancels an open that is still waiting for its welcome, and counts no failed hello', async () => {
      let heard: AbortSignal | undefined
      const { controller, failed, done } = loop(
        (signal) =>
          new Promise<Device>((_, reject) => {
            heard = signal
            signal.addEventListener('abort', () => reject(new Error('open aborted')))
          }),
        {},
      )

      await vi.advanceTimersByTimeAsync(1)

      expect(heard).toBe(controller.signal)

      controller.abort()

      // No time passes: the open is cut at the abort, not at its own timeout.
      expect(await done).toEqual({ kind: 'stopped' })
      expect(failed).toEqual([])
    })

    it('closes a welcome that comes after the deadline, though the abort has not fired yet', async () => {
      let clock = 0
      const welcome = deferred<Device>()
      const late = device()
      const { failed, done } = loop(() => welcome.promise, { until: 100, now: () => clock })

      await vi.advanceTimersByTimeAsync(1)
      clock = 101
      welcome.resolve(late)

      expect(await done).toEqual({ kind: 'stopped' })
      expect(late.close).toHaveBeenCalledTimes(1)
      expect(failed).toEqual([])
    })

    it('keeps a welcome that comes in time, however close to the deadline', async () => {
      let clock = 0
      const welcome = deferred<Device>()
      const onTime = device()
      const { done } = loop(() => welcome.promise, { until: 100, now: () => clock })

      await vi.advanceTimersByTimeAsync(1)
      clock = 100
      welcome.resolve(onTime)

      expect(await done).toEqual({ kind: 'welcomed', value: onTime, at: 100 })
      expect(onTime.close).not.toHaveBeenCalled()
    })

    it('closes a welcome of an open that did not hear the abort, and stops', async () => {
      const welcome = deferred<Device>()
      const late = device()
      const { controller, failed, done } = loop(() => welcome.promise, {})

      await vi.advanceTimersByTimeAsync(1)
      controller.abort()
      welcome.resolve(late)

      expect(await done).toEqual({ kind: 'stopped' })
      expect(late.close).toHaveBeenCalledTimes(1)
      expect(failed).toEqual([])
    })
  })
})
