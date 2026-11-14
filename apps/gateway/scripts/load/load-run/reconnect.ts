/** One device's reconnect loop: the transport's own, which the load test's raw devices lack. */

import { type EndReason, endingOf, reconnectDelay } from '@workspace/replica/sync'

import { ClosedBeforeWelcome } from '../closed-before-welcome'

import { pause } from './pacing'

/** How a reconnect loop ended. */
export type Reconnected<T> =
  /** An open was welcomed in time, at the instant `at` (of `now`): `value` is what it resolved with. */
  | { readonly kind: 'welcomed'; readonly value: T; readonly at: number }
  /** An open was closed with a code the gateway ends a device with: no reconnect follows. */
  | { readonly kind: 'ended'; readonly reason: EndReason }
  /** The loop was stopped, or its deadline passed, before an open was welcomed in time. */
  | { readonly kind: 'stopped' }

export interface ReconnectOptions {
  /**
   * Stops the loop, and cancels the open in flight, which `open` hears through the signal it is
   * given: its rejection then counts as no failed hello.
   */
  readonly signal: AbortSignal
  /** The instant (of `now`) after which a welcome is too late: its device is closed, not kept. */
  readonly until: number
  /** Hears each open that was rejected, an ending close apart: refused, closed or not welcomed. */
  readonly onFailed: (cause: unknown) => void
  /** How long to wait before reconnect `attempt` of a row, the first being 0. */
  readonly delay?: (attempt: number) => number
  /** The clock of `until`, `performance.now()` by default. */
  readonly now?: () => number
}

/**
 * Opens as the transport reconnects: at attempt 0 it waits `delay(0)` and calls `open`; a
 * rejection counts one attempt more and the loop waits again, until an open is welcomed. An
 * open that rejected with a close code `endingOf` maps to an ending stops the loop for good.
 * A welcome that comes once the signal has aborted or `until` has passed is too late: the loop
 * closes what it opened and stops. The delay is the replica's own `reconnectDelay`, drawn from
 * `Math.random` as the transport draws it.
 */
export async function reconnect<T extends { close: () => void }>(
  open: (signal: AbortSignal) => Promise<T>,
  {
    signal,
    until,
    onFailed,
    delay = (attempt) => reconnectDelay(attempt, Math.random),
    now = () => performance.now(),
  }: ReconnectOptions,
): Promise<Reconnected<T>> {
  for (let attempt = 0; !signal.aborted; attempt++) {
    await pause(delay(attempt), signal)

    if (signal.aborted) break

    try {
      const value = await open(signal)
      const at = now()

      if (signal.aborted || at > until) {
        value.close()

        break
      }

      return { kind: 'welcomed', value, at }
    } catch (cause) {
      // An open cancelled by the abort is not a failed hello.
      if (signal.aborted) break

      const reason = cause instanceof ClosedBeforeWelcome ? endingOf(cause.code) : undefined

      if (reason) return { kind: 'ended', reason }

      onFailed(cause)
    }
  }

  return { kind: 'stopped' }
}
