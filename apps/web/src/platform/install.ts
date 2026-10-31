/**
 * Installing the app on this device, as the frame's reminder needs it. A Chromium browser that
 * can install the app says so with `beforeinstallprompt`, whose `prompt()` opens its own window;
 * Safari on an iPhone or an iPad has no such window, so only the user's steps install the app
 * there (Share, then Add to Home Screen). The reminder is put off for three days at a time on
 * this device, and goes for good once the app is installed (the browser's choice, its
 * `appinstalled`, or the app running as the installed app). The start makes it before the first
 * frame, so an offer the browser makes early is heard.
 */

import { createContext, useContext } from 'react'

/** What the reminder says now: the browser installs the app, or only the user's steps do. */
export type InstallOffer = 'install-offered' | 'install-by-steps' | 'installed'

const LATER = 'perch.install.later'
const INSTALLED = 'perch.install.installed'
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

/** The browser's offer to install the app, which `lib.dom` does not name. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

const isInstallPrompt = (event: Event): event is InstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event

export interface DeviceInstall {
  /** What the reminder says now; none while it is put off, or with nothing to offer. */
  current(): InstallOffer | undefined
  subscribe(listener: () => void): () => void
  /** Opens the browser's own window; a decline puts the reminder off. Fails with no window to open. */
  prompt(): Promise<void>
  /** Puts the reminder off for three days on this device. */
  postpone(): void
}

/** What installing reads and hears: the device's storage, the clock, the page and the browser. */
export interface InstallEnvironment {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  readonly now: () => number
  /** Whether the app runs as the installed app. */
  readonly standalone: () => boolean
  /** Whether only the user's own steps install the app here (Safari on an iPhone or an iPad). */
  readonly bySteps: boolean
  readonly page: Pick<Window, 'addEventListener'>
}

export function createDeviceInstall(env: InstallEnvironment): DeviceInstall {
  const listeners = new Set<() => void>()
  let offered: InstallPromptEvent | undefined
  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  const installed = () => {
    env.storage.setItem(INSTALLED, '1')
    offered = undefined
    notify()
  }
  const postpone = () => {
    env.storage.setItem(LATER, String(env.now() + THREE_DAYS))
    notify()
  }

  env.page.addEventListener('beforeinstallprompt', (event) => {
    if (isInstallPrompt(event)) {
      // The browser shows its own bar otherwise; the frame's reminder asks instead.
      event.preventDefault()
      offered = event
      notify()
    }
  })
  env.page.addEventListener('appinstalled', installed)

  return {
    current() {
      if (env.storage.getItem(INSTALLED) === '1' || env.standalone()) {
        return 'installed'
      }

      if (env.now() < Number(env.storage.getItem(LATER) ?? 0)) {
        return undefined
      }

      return offered ? 'install-offered' : env.bySteps ? 'install-by-steps' : undefined
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    async prompt() {
      const offer = offered

      if (!offer) {
        throw new Error('the browser offers no window to install the app')
      }

      // The browser's offer serves one window.
      offered = undefined
      await offer.prompt()

      const { outcome } = await offer.userChoice

      if (outcome === 'accepted') {
        installed()
      } else {
        postpone()
      }
    },
    postpone,
  }
}

/** Safari on an iPhone or an iPad (which may say it is a Mac), not another browser built on it. */
function safariOnIos(page: Window): boolean {
  const agent = page.navigator.userAgent
  const ios =
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && page.navigator.maxTouchPoints > 1)

  return ios && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent)
}

/** Installing on this page's device, as the start makes it. */
export function browserInstall(): DeviceInstall {
  return createDeviceInstall({
    // Read when used: the frame offers nothing before the start opened, which checks site data.
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    now: () => Date.now(),
    standalone: () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && window.navigator.standalone === true),
    bySteps: safariOnIos(window),
    page: window,
  })
}

export const InstallContext = createContext<DeviceInstall | undefined>(undefined)

/** Installing on this device, for a view under the start's provider. */
export function useDeviceInstall(): DeviceInstall {
  const install = useContext(InstallContext)

  if (!install) {
    throw new Error('useDeviceInstall needs the install the start provides')
  }

  return install
}
