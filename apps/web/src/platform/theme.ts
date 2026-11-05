/**
 * The theme of this device: light, dark, or the system's own, shown as the class `dark` on
 * `<html>`, which the kit's dark colors follow, and kept in this browser as the theme this device
 * showed last. Under the system's theme the page follows the device's setting as it changes. A
 * guest chooses it in the frame (`platform.theme.set`), and the other guest tabs of the browser
 * follow it (`platform.theme-set`); a signed-in tab shows and keeps the account's theme. The start
 * makes it before the first frame, so the kept theme shows at once, before any data opens.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'

export const THEMES = ['light', 'dark', 'system'] as const

export type Theme = (typeof THEMES)[number]

/** The key the theme this device showed last is kept under, shared by the browser's tabs. */
export const THEME_KEY = 'perch.theme'

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value)

export interface DeviceTheme {
  current(): Theme
  /** Shows `theme` at once and keeps it on this device. */
  set(theme: Theme): void
  /** Shows the theme this device keeps, which another tab of the browser chose; keeps nothing. */
  follow(): void
  subscribe(listener: () => void): () => void
}

/** What the theme reads and writes: the browser's storage, the device's dark setting, the page. */
export interface ThemeEnvironment {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  readonly dark: {
    readonly matches: boolean
    addEventListener(type: 'change', listener: () => void): void
  }
  readonly root: HTMLElement
}

export function createDeviceTheme(env: ThemeEnvironment): DeviceTheme {
  const listeners = new Set<() => void>()
  /** The theme the browser keeps; a browser that keeps no site data keeps none. */
  const kept = (): Theme => {
    try {
      const value = env.storage.getItem(THEME_KEY)

      return isTheme(value) ? value : 'system'
    } catch {
      return 'system'
    }
  }
  // A browser that keeps no site data still shows a theme, kept for this page only.
  let theme: Theme = kept()

  const show = () => {
    env.root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && env.dark.matches))
  }
  const shown = (next: Theme) => {
    theme = next
    show()
    for (const listener of listeners) {
      listener()
    }
  }

  env.dark.addEventListener('change', show)
  show()

  return {
    current: () => theme,
    set: (next) => {
      try {
        env.storage.setItem(THEME_KEY, next)
      } catch {
        // Kept for this page only, as the browser keeps nothing.
      }
      shown(next)
    },
    follow: () => shown(kept()),
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}

/** The theme of this page's device, as the start makes it. */
export function browserTheme(): DeviceTheme {
  return createDeviceTheme({
    // Read when used: a browser that keeps no site data throws at `localStorage` itself.
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    dark: window.matchMedia('(prefers-color-scheme: dark)'),
    root: document.documentElement,
  })
}

export const ThemeContext = createContext<DeviceTheme | undefined>(undefined)

/**
 * The device's theme, the way to choose another and to follow one another tab chose, for a view
 * under the start's provider.
 */
export function useDeviceTheme(): {
  readonly theme: Theme
  readonly set: (theme: Theme) => void
  readonly follow: () => void
} {
  const device = useContext(ThemeContext)

  if (!device) {
    throw new Error('useDeviceTheme needs the theme the start provides')
  }

  const theme = useSyncExternalStore(
    (onChange) => device.subscribe(onChange),
    () => device.current(),
  )

  return { theme, set: device.set, follow: device.follow }
}
