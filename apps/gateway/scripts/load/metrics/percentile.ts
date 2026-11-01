/** The value below which `share` of the samples fall (nearest rank); `NaN` for no samples. */
export function percentile(samples: readonly number[], share: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(share * sorted.length))

  return sorted[rank - 1] ?? Number.NaN
}
