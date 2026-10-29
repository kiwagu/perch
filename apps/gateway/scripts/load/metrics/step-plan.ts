/** How many devices a step holds in all and how many it adds to the step before. */
export interface Step {
  readonly total: number
  readonly add: number
}

/** The steps of a ramp: each device count must be larger than the one before it. */
export function stepPlan(devices: readonly number[]): readonly Step[] {
  if (devices.length === 0 || devices.some((total, i) => total <= (devices[i - 1] ?? 0))) {
    throw new Error('devices must grow')
  }

  return devices.map((total, i) => ({ total, add: total - (devices[i - 1] ?? 0) }))
}
