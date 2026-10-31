import type { DeviceInstall, InstallOffer } from '../install'

/**
 * Installing kept in memory, for a test that renders the frame: nothing to offer at first;
 * `offer` stands for the browser's offer, `prompted` and `postponed` count what the frame asked.
 */
export function memoryInstall(): DeviceInstall & {
  readonly offer: (offer: InstallOffer | undefined) => void
  readonly prompted: () => number
  readonly postponed: () => number
} {
  const listeners = new Set<() => void>()
  let current: InstallOffer | undefined
  let prompts = 0
  let postpones = 0
  const set = (next: InstallOffer | undefined) => {
    current = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    prompt: () => {
      prompts += 1
      set('installed')

      return Promise.resolve()
    },
    postpone: () => {
      postpones += 1
      set(undefined)
    },
    offer: set,
    prompted: () => prompts,
    postponed: () => postpones,
  }
}
