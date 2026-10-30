/**
 * The theme of this device: light, dark, or the system's own, kept in this browser and shown as
 * the class `dark` on `<html>`, which the kit's dark colors follow. Under the system's theme the
 * page follows the device's setting as it changes. The settings screen chooses it
 * (`platform.theme.set`); the start makes it before the first frame, so the kept theme shows at once.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'

export const THEMES = ['light', 'dark', 'system'] as const

export type Theme = (typeof THEMES)[number]

const KEY = 'perch.theme'

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value)

export interface DeviceTheme {
  current(): Theme
  /** Shows `theme` at once and keeps it on this device. */
  set(theme: Theme): void
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
  let theme: Theme = 'system'

  // A browser that keeps no site data still shows a theme, kept for this page only.
  try {
    const kept = env.storage.getItem(KEY)

    theme = isTheme(kept) ? kept : 'system'
  } catch {
    theme = 'system'
  }

  const show = () => {
    env.root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && env.dark.matches))
  }

  env.dark.addEventListener('change', show)
  show()

  return {
    current: () => theme,
    set: (next) => {
      theme = next
      try {
        env.storage.setItem(KEY, next)
      } catch {
        // Kept for this page only, as the browser keeps nothing.
      }
      show()
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

/** The device's theme and the way to choose another, for a view under the start's provider. */
export function useDeviceTheme(): { readonly theme: Theme; readonly set: (theme: Theme) => void } {
  const device = useContext(ThemeContext)

  if (!device) {
    throw new Error('useDeviceTheme needs the theme the start provides')
  }

  const theme = useSyncExternalStore(
    (onChange) => device.subscribe(onChange),
    () => device.current(),
  )

  return { theme, set: device.set }
}
