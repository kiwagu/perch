// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createDeviceTheme } from './theme'

/** The device's own dark setting, which a test turns on and off. */
function darkSetting(matches = false) {
  const listeners = new Set<() => void>()

  return {
    query: {
      get matches() {
        return matches
      },
      addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
    },
    turn(on: boolean) {
      matches = on
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  }
}

describe('createDeviceTheme', () => {
  it("starts with the system's own theme and follows the device's setting as it changes", () => {
    const root = document.createElement('html')
    const setting = darkSetting(true)
    const theme = createDeviceTheme({ storage: memoryStorage(), dark: setting.query, root })

    expect(theme.current()).toBe('system')
    expect(root.classList.contains('dark')).toBe(true)

    setting.turn(false)

    expect(root.classList.contains('dark')).toBe(false)
  })

  it('shows a chosen theme at once, keeps it on the device and stops following the system', () => {
    const root = document.createElement('html')
    const setting = darkSetting(false)
    const storage = memoryStorage()
    const theme = createDeviceTheme({ storage, dark: setting.query, root })
    let told = 0

    theme.subscribe(() => {
      told += 1
    })
    theme.set('dark')

    expect(root.classList.contains('dark')).toBe(true)
    expect(storage.items.get('perch.theme')).toBe('dark')
    expect(told).toBe(1)

    setting.turn(false)
    theme.set('light')
    setting.turn(true)

    expect(root.classList.contains('dark')).toBe(false)
    expect(theme.current()).toBe('light')
  })

  it('starts with the theme the device kept, and with the system for anything else', () => {
    const root = document.createElement('html')

    expect(
      createDeviceTheme({
        storage: memoryStorage({ 'perch.theme': 'dark' }),
        dark: darkSetting(false).query,
        root,
      }).current(),
    ).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(
      createDeviceTheme({
        storage: memoryStorage({ 'perch.theme': 'sepia' }),
        dark: darkSetting(false).query,
        root: document.createElement('html'),
      }).current(),
    ).toBe('system')
  })

  it('still shows a theme on a browser that keeps no site data', () => {
    const root = document.createElement('html')
    const refusing = {
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const theme = createDeviceTheme({ storage: refusing, dark: darkSetting(false).query, root })

    theme.set('dark')

    expect(theme.current()).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
  })
})
