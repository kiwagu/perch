/** How long the transport waits before each reconnect in a row; the last delay repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]

/** The delay before reconnect `attempt` of a row, the first being 0. */
export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 0
}
