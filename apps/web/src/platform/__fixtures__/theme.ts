import type { DeviceTheme, Theme } from '../theme'

/** A device theme kept in memory, for a test that renders a view showing or choosing one. */
export function memoryTheme(initial: Theme = 'system'): DeviceTheme {
  const listeners = new Set<() => void>()
  let theme = initial

  return {
    current: () => theme,
    set: (next) => {
      theme = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
