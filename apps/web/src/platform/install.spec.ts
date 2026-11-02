import { describe, expect, it, vi } from 'vitest'

import { createDeviceInstall, type InstallEnvironment } from './install'

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

/** A device: its storage, its clock, its page; the browser's offer is dispatched by the test. */
function device(options: { readonly bySteps?: boolean; readonly standalone?: boolean } = {}) {
  const kept = new Map<string, string>()
  let now = 1_000_000
  const page = new EventTarget()
  const env: InstallEnvironment = {
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
    },
    now: () => now,
    standalone: () => options.standalone === true,
    bySteps: options.bySteps === true,
    page: { addEventListener: page.addEventListener.bind(page) },
  }
  const install = createDeviceInstall(env)
  const heard = vi.fn()

  install.subscribe(heard)

  return {
    install,
    heard,
    later: (ms: number) => {
      now += ms
    },
    /** The browser offers to install, its window answering `outcome`. */
    offer: (outcome: 'accepted' | 'dismissed' = 'accepted') => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: vi.fn(() => Promise.resolve()),
        userChoice: Promise.resolve({ outcome }),
      })

      page.dispatchEvent(event)

      return event
    },
    installedByBrowser: () => page.dispatchEvent(new Event('appinstalled')),
    /** A new page on the same device: the same storage and clock, no offer heard yet. */
    reloaded: () => createDeviceInstall(env),
  }
}

describe('createDeviceInstall', () => {
  it("offers nothing until the browser offers, then holds the browser's offer back for the frame", () => {
    const phone = device()

    expect(phone.install.current()).toBeUndefined()

    const event = phone.offer()

    expect(event.defaultPrevented).toBe(true)
    expect(phone.install.current()).toBe('install-offered')
    expect(phone.heard).toHaveBeenCalled()
  })

  it("opens the browser's window, and an accepted install ends the reminder for good on this device", async () => {
    const phone = device()
    const event = phone.offer('accepted')

    await phone.install.prompt()

    expect(event.prompt).toHaveBeenCalledOnce()
    expect(phone.install.current()).toBe('installed')
    expect(phone.reloaded().current()).toBe('installed')
  })

  it('puts the reminder off for three days when the window is declined or the user says later', async () => {
    const phone = device()

    phone.offer('dismissed')
    await phone.install.prompt()

    expect(phone.install.current()).toBeUndefined()

    const next = phone.reloaded()

    phone.offer()

    // A new offer within the three days says nothing.
    expect(next.current()).toBeUndefined()

    phone.later(THREE_DAYS + 1)

    expect(next.current()).toBe('install-offered')

    next.postpone()

    expect(next.current()).toBeUndefined()
  })

  it('refuses to open a window the browser did not offer, or offered once already', async () => {
    const phone = device()

    await expect(phone.install.prompt()).rejects.toThrow('no window')

    phone.offer('dismissed')
    await phone.install.prompt()
    phone.later(THREE_DAYS + 1)

    await expect(phone.install.prompt()).rejects.toThrow('no window')
  })

  it('shows the steps where only they install the app, and nothing in the installed app', () => {
    expect(device({ bySteps: true }).install.current()).toBe('install-by-steps')
    expect(device({ bySteps: true, standalone: true }).install.current()).toBe('installed')
  })

  it('ends the reminder when the browser says the app was installed', () => {
    const phone = device()

    phone.offer()
    phone.installedByBrowser()

    expect(phone.install.current()).toBe('installed')
  })
})
