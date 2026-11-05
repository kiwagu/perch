import type { DeviceTheme, Theme } from '../theme'

/**
 * A device theme kept in memory, for a test that renders a view showing or choosing one;
 * `keepElsewhere` keeps a theme as another tab of the browser would, which `follow` then shows.
 */
export function memoryTheme(
  initial: Theme = 'system',
): DeviceTheme & { readonly keepElsewhere: (theme: Theme) => void } {
  const listeners = new Set<() => void>()
  let theme = initial
  let kept = initial
  const shown = (next: Theme) => {
    theme = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    current: () => theme,
    set: (next) => {
      kept = next
      shown(next)
    },
    follow: () => shown(kept),
    keepElsewhere: (next) => {
      kept = next
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
