/**
 * The step of each reconnect in a row: its delay is drawn from 0 up to the step, so the devices
 * that one failure drops do not come back at the same instants. The last step repeats.
 */
export const RECONNECT_STEPS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

/** How long a waiting reconnect waits at most once the device's network is back. */
export const NETWORK_BACK_DELAY_MS = 1_000

/**
 * The delay before reconnect `attempt` of a row, the first being 0: `random()`, a number in
 * [0, 1), of the attempt's step, in whole milliseconds, so never the step itself.
 */
export function reconnectDelay(attempt: number, random: () => number): number {
  const step = RECONNECT_STEPS_MS[Math.min(attempt, RECONNECT_STEPS_MS.length - 1)] ?? 0

  return Math.floor(random() * step)
}

/**
 * How long a waiting reconnect waits once the device's network is back: `random()`, a number in
 * [0, 1), of `NETWORK_BACK_DELAY_MS`, in whole milliseconds.
 */
export function networkBackDelay(random: () => number): number {
  return Math.floor(random() * NETWORK_BACK_DELAY_MS)
}
