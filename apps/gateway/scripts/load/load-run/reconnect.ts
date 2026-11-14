/** One device's reconnect loop: the transport's own, which the load test's raw devices lack. */

import { setTimeout as sleepFor } from 'node:timers/promises'

import { type EndReason, endingOf, reconnectDelay } from '@workspace/replica/sync'

import { ClosedBeforeWelcome } from '../closed-before-welcome'

/** How a reconnect loop ended. */
export type Reconnected<T> =
  /** An open was welcomed: `value` is what it resolved with. */
  | { readonly kind: 'welcomed'; readonly value: T }
  /** An open was closed with a code the gateway ends a device with: no reconnect follows. */
  | { readonly kind: 'ended'; readonly reason: EndReason }
  /** The loop was stopped before an open was welcomed. */
  | { readonly kind: 'stopped' }

export interface ReconnectOptions {
  /** Stops the loop at its next wait or attempt; an open in flight still runs to its end. */
  readonly signal: AbortSignal
  /** Hears each open that was rejected, an ending close apart: refused, closed or not welcomed. */
  readonly onFailed: (cause: unknown) => void
  /** How long to wait before reconnect `attempt` of a row, the first being 0. */
  readonly delay?: (attempt: number) => number
}

/**
 * Opens as the transport reconnects: at attempt 0 it waits `delay(0)` and calls `open`; a
 * rejection counts one attempt more and the loop waits again, until an open is welcomed. An
 * open that rejected with a close code `endingOf` maps to an ending stops the loop for good.
 * The delay is the replica's own `reconnectDelay`.
 */
export async function reconnect<T>(
  open: () => Promise<T>,
  { signal, onFailed, delay = reconnectDelay }: ReconnectOptions,
): Promise<Reconnected<T>> {
  for (let attempt = 0; !signal.aborted; attempt++) {
    // An abort during the wait rejects it: the loop's own check ends it.
    await sleepFor(delay(attempt), undefined, { signal }).catch(() => undefined)

    if (signal.aborted) break

    try {
      return { kind: 'welcomed', value: await open() }
    } catch (cause) {
      const reason = cause instanceof ClosedBeforeWelcome ? endingOf(cause.code) : undefined

      if (reason) return { kind: 'ended', reason }

      onFailed(cause)
    }
  }

  return { kind: 'stopped' }
}
