import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { Locale } from '@workspace/i18n'

import type { Theme } from '../../../platform/theme'

import { LocaleWrites } from './locale-writes'
import { createShellMachine, type ShellValues } from './shell.machine'

/**
 * A frame over its machine: what the guards read and what the machine emitted; `reloadedFor`
 * holds the updates this tab already loaded the page again for by itself.
 */
function frame(reloadedFor: string[] = []) {
  let values: ShellValues = {
    account: undefined,
    stored: undefined,
    writes: LocaleWrites.none,
    unsaved: false,
  }
  const signOutHere = vi.fn(() => okAsync(undefined))
  const reload = vi.fn()
  const setTheme = vi.fn<(theme: Theme) => void>()
  const selfReloads = {
    done: (update: string) => reloadedFor.includes(update),
    mark: (update: string) => void reloadedFor.push(update),
  }
  const install = {
    prompt: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    postpone: vi.fn<() => void>(),
  }
  const actor = createActor(
    createShellMachine({
      values: () => values,
      signOutHere,
      reload,
      setTheme,
      selfReloads,
      install,
    }),
  ).start()
  const spoken: Locale[] = []
  const emitted: unknown[] = []

  actor.on('speak', ({ locale }) => spoken.push(locale))
  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    signOutHere,
    reload,
    setTheme,
    install,
    spoken,
    emitted,
    signIn: (account = 'idn_ann') => {
      values = { ...values, account }
    },
    /** The account goes away, by its own sign-out or from another device. */
    signOut: () => {
      values = { ...values, account: undefined, stored: undefined, writes: LocaleWrites.none }
      actor.send({ type: 'platform.signed-out' })
    },
    /** The settings arrive or change on this device, here or from another one. */
    store: (stored: string) => {
      values = { ...values, stored }
      actor.send({ type: 'model.settings.locale' })
      values = { ...values, writes: values.writes.arrived(stored) }
    },
    /** This device's own writes of the language, as the settings screen tells them. */
    write: (step: (writes: LocaleWrites) => LocaleWrites) => {
      values = { ...values, writes: step(values.writes) }
    },
    /** A field starts holding unsaved input, or stops. */
    type: (unsaved: boolean) => {
      values = { ...values, unsaved }
    },
    choose: (locale: Locale) => actor.send({ type: 'app-shell.locale-select', locale }),
    chooseTheme: (theme: Theme) => actor.send({ type: 'app-shell.theme-select', theme }),
    canChooseTheme: () =>
      actor.getSnapshot().can({ type: 'app-shell.theme-select', theme: 'dark' }),
    canChoose: () => actor.getSnapshot().can({ type: 'app-shell.locale-select', locale: 'en' }),
    canUpdate: () => actor.getSnapshot().can({ type: 'app-shell.update-button' }),
    is: (state: 'ready' | 'failed' | 'crashed' | 'updating' | 'reloading' | 'installing') =>
      actor.getSnapshot().matches(state),
  }
}

const CLEARED = { type: 'clear', anchor: 'app-shell.notice-message' }
const CRASHED = { type: 'show', anchor: 'app-shell.crash-message', codes: ['screen-crashed'] }
const CRASH_CLEARED = { type: 'clear', anchor: 'app-shell.crash-message' }
const NEW_VERSION = { type: 'show', anchor: 'app-shell.update-message', codes: ['new-version'] }
const PROTOCOL_OUTDATED = {
  type: 'show',
  anchor: 'app-shell.update-message',
  codes: ['protocol-outdated'],
}
const SERVED = '0.2.0+2b9a0c1d'
const SYNC_CLEARED = { type: 'clear', anchor: 'app-shell.sync-message' }
const syncShown = (code: string) => ({
  type: 'show',
  anchor: 'app-shell.sync-message',
  codes: [code],
})

const sameAs = (event: unknown, expected: object): boolean =>
  JSON.stringify(event) === JSON.stringify(expected)

describe('shell machine', () => {
  it('opens the frame, or says the data failed or the browser keeps none', () => {
    const opened = frame()

    opened.actor.send({ type: 'platform.opened' })

    expect(opened.is('ready')).toBe(true)

    const failed = frame()

    failed.actor.send({ type: 'platform.open-failed' })

    expect(failed.is('failed')).toBe(true)

    const blocked = frame()

    blocked.actor.send({ type: 'platform.storage-blocked' })

    expect(blocked.actor.getSnapshot().status).toBe('done')
    expect(blocked.canChoose()).toBe(false)
  })

  it('speaks a language chosen while the data opens, or failed to', () => {
    const shell = frame()

    shell.choose('es')
    shell.actor.send({ type: 'platform.open-failed' })
    shell.choose('en')

    expect(shell.spoken).toEqual(['es', 'en'])
  })

  it("speaks a guest's choice with nothing to store", () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.choose('es')

    expect(shell.is('ready')).toBe(true)
    expect(shell.spoken).toEqual(['es'])
  })

  it('takes no language from a signed-in account: its settings screen does', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('en')

    expect(shell.canChoose()).toBe(false)

    shell.signOut()

    expect(shell.canChoose()).toBe(true)
  })

  it('clears the notice and the state of the sync when the account signs out', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.actor.send({ type: 'platform.signed-out' })

    expect(shell.emitted).toEqual([CLEARED, SYNC_CLEARED])
    expect(shell.is('ready')).toBe(true)
  })

  it('says on the notice that a change was refused, and refused again', () => {
    const shell = frame()
    const REJECTED = {
      type: 'show',
      anchor: 'app-shell.notice-message',
      codes: ['change-rejected'],
    }
    const RELOADED = {
      type: 'show',
      anchor: 'app-shell.notice-message',
      codes: ['changes-reloaded'],
    }

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.change-rejected' })
    shell.actor.send({ type: 'platform.changes-reloaded' })

    expect(shell.emitted).toEqual([REJECTED, RELOADED])
  })

  it('speaks a language stored that this device has not seen yet, once', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('es')
    shell.store('es')
    shell.store('en')

    expect(shell.spoken).toEqual(['es', 'en'])
  })

  it("takes this device's own writes coming back late for its own, a failed one too", () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()
    shell.store('en')
    // The settings screen stores es, then en, and en's store fails; es comes back late.
    shell.write((writes) => writes.writing('es').writing('en').failed('en'))
    shell.store('es')

    expect(shell.spoken).toEqual(['en'])

    // Another device stores en afterwards: that one is spoken.
    shell.store('en')

    expect(shell.spoken).toEqual(['en', 'en'])
  })

  it('applies a theme chosen while the data opens, once open, signed in or not, and if it failed', () => {
    const opening = frame()

    opening.chooseTheme('dark')
    opening.actor.send({ type: 'platform.opened' })
    opening.chooseTheme('light')
    opening.signIn()
    opening.chooseTheme('system')

    expect(opening.setTheme.mock.calls).toEqual([['dark'], ['light'], ['system']])
    expect(opening.is('ready')).toBe(true)

    const failed = frame()

    failed.actor.send({ type: 'platform.open-failed' })
    failed.chooseTheme('dark')

    expect(failed.setTheme).toHaveBeenCalledWith('dark')
    expect(failed.is('failed')).toBe(true)
  })

  it('applies a theme chosen around a crash, the message staying', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })
    shell.chooseTheme('dark')

    expect(shell.setTheme).toHaveBeenCalledWith('dark')
    expect(shell.is('crashed')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(CRASHED)
  })

  it('takes no theme once the browser keeps no site data', () => {
    const blocked = frame()

    blocked.actor.send({ type: 'platform.storage-blocked' })

    expect(blocked.canChooseTheme()).toBe(false)
  })

  it('signs the saved account out here when its data failed, then moves to sign-in', async () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.open-failed' })
    shell.actor.send({ type: 'app-shell.sign-out-here-button' })

    expect(shell.actor.getSnapshot().can({ type: 'app-shell.sign-out-here-button' })).toBe(false)

    await waitFor(shell.actor, (state) => state.status === 'done')

    expect(shell.signOutHere).toHaveBeenCalledOnce()
    expect(shell.emitted).toContainEqual({ type: 'navigate', to: '/sign-in' })
  })

  it('says a screen that failed to render, and takes it away when another screen opens', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })

    expect(shell.is('crashed')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(CRASHED)
    expect(shell.actor.getSnapshot().can({ type: 'app-shell.reload-button' })).toBe(true)
    // A guest's language select stays usable around the message.
    expect(shell.canChoose()).toBe(true)

    shell.actor.send({ type: 'platform.navigated' })

    expect(shell.is('ready')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(CRASH_CLEARED)
    expect(shell.actor.getSnapshot().can({ type: 'app-shell.reload-button' })).toBe(false)
  })

  it("renders the screen again in a guest's language chosen after a crash", () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })
    shell.choose('es')

    expect(shell.is('ready')).toBe(true)
    expect(shell.spoken).toEqual(['es'])
    expect(shell.emitted.some((event) => sameAs(event, CRASH_CLEARED))).toBe(true)
  })

  it('loads the page again from the crash message', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })
    shell.actor.send({ type: 'app-shell.reload-button' })

    expect(shell.reload).toHaveBeenCalledOnce()
  })

  it('offers to load a newer build the server serves, and loads it from the button', async () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.new-version', served: SERVED })

    expect(shell.emitted.at(-1)).toEqual(NEW_VERSION)
    expect(shell.canUpdate()).toBe(true)

    shell.actor.send({ type: 'app-shell.update-button' })

    expect(shell.is('updating')).toBe(true)
    expect(shell.reload).toHaveBeenCalledOnce()

    // Only while the page has not loaded again; the message stays.
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.emitted.at(-1)).toEqual(NEW_VERSION)
  })

  it('says a protocol the server no longer takes, which a newer build heard later does not replace', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.new-version', served: SERVED })
    shell.actor.send({ type: 'platform.protocol-refused' })

    expect(shell.emitted.at(-1)).toEqual(PROTOCOL_OUTDATED)

    shell.actor.send({ type: 'platform.new-version', served: '0.3.0+9f8e7d6c' })

    expect(shell.emitted.at(-1)).toEqual(PROTOCOL_OUTDATED)
    expect(shell.canUpdate()).toBe(true)
  })

  it('loads the page again by itself when the tab goes to the background with an update waiting and nothing unsaved', () => {
    const reloadedFor: string[] = []
    const shell = frame(reloadedFor)

    shell.actor.send({ type: 'platform.opened' })
    // No update waits yet.
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('ready')).toBe(true)

    shell.actor.send({ type: 'platform.new-version', served: SERVED })
    // A field holds unsaved input: the page stays.
    shell.type(true)
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('ready')).toBe(true)
    expect(shell.reload).not.toHaveBeenCalled()

    shell.type(false)
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('updating')).toBe(true)
    expect(shell.reload).toHaveBeenCalledOnce()
    expect(reloadedFor).toEqual([SERVED])
  })

  it('loads the page again by itself once per update: a server still serving it afterwards starts no loop', () => {
    const shell = frame([SERVED, 'protocol'])

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.new-version', served: SERVED })
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('ready')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(NEW_VERSION)

    shell.actor.send({ type: 'platform.protocol-refused' })
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('ready')).toBe(true)
    expect(shell.reload).not.toHaveBeenCalled()
    // The button still loads it.
    expect(shell.canUpdate()).toBe(true)
  })

  it('says an update around a crash, the crash message staying, and loads the page again', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })
    shell.actor.send({ type: 'platform.protocol-refused' })

    expect(shell.is('crashed')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(PROTOCOL_OUTDATED)

    shell.actor.send({ type: 'app-shell.update-button' })

    expect(shell.is('reloading')).toBe(true)
    expect(shell.reload).toHaveBeenCalledOnce()
  })

  it('loads the page again by itself around a crash too, when the tab goes to the background', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.crashed' })
    shell.actor.send({ type: 'platform.new-version', served: SERVED })
    shell.actor.send({ type: 'platform.tab-hidden' })

    expect(shell.is('reloading')).toBe(true)
    expect(shell.reload).toHaveBeenCalledOnce()
  })

  it('takes no update while the data opens or once it failed to', () => {
    const opening = frame()

    expect(opening.actor.getSnapshot().can({ type: 'platform.new-version', served: SERVED })).toBe(
      false,
    )
    expect(opening.canUpdate()).toBe(false)

    const failed = frame()

    failed.actor.send({ type: 'platform.open-failed' })

    expect(failed.actor.getSnapshot().can({ type: 'platform.protocol-refused' })).toBe(false)
    expect(failed.canUpdate()).toBe(false)
  })

  it('says the state of the sync the platform gives, around a crash too', () => {
    const shell = frame()

    shell.actor.send({ type: 'platform.opened' })
    shell.signIn()

    for (const code of ['connecting', 'synced', 'sending', 'offline', 'sync-stopped'] as const) {
      shell.actor.send({ type: `platform.${code}` })

      expect(shell.emitted.at(-1)).toEqual(syncShown(code))
    }

    shell.actor.send({ type: 'platform.crashed' })
    shell.actor.send({ type: 'platform.synced' })

    expect(shell.is('crashed')).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(syncShown('synced'))
  })

  it('takes no state of the sync while the data opens or once it failed to', () => {
    const opening = frame()

    expect(opening.actor.getSnapshot().can({ type: 'platform.synced' })).toBe(false)

    const failed = frame()

    failed.actor.send({ type: 'platform.open-failed' })

    expect(failed.actor.getSnapshot().can({ type: 'platform.offline' })).toBe(false)
  })

  it('reminds to install the app, installs it from the button, and puts it off from later', async () => {
    const shell = frame()
    const installShown = {
      type: 'show',
      anchor: 'app-shell.install-message',
      codes: ['install-available'],
    }
    const installGone = { type: 'clear', anchor: 'app-shell.install-message' }

    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.install-offered' })

    expect(shell.emitted.at(-1)).toEqual(installShown)

    shell.actor.send({ type: 'app-shell.install-button' })

    expect(shell.is('installing')).toBe(true)
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.install.prompt).toHaveBeenCalledOnce()
    expect(shell.emitted.at(-1)).toEqual(installGone)

    shell.actor.send({ type: 'platform.install-by-steps' })
    shell.actor.send({ type: 'app-shell.install-later-button' })
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.install.postpone).toHaveBeenCalledOnce()
    expect(shell.emitted.at(-1)).toEqual(installGone)

    shell.actor.send({ type: 'platform.installed' })

    expect(shell.emitted.at(-1)).toEqual(installGone)
  })

  it('takes the reminder away when the browser shows no window after all', async () => {
    const shell = frame()

    shell.install.prompt.mockImplementation(() => Promise.reject(new Error('no window')))
    shell.actor.send({ type: 'platform.opened' })
    shell.actor.send({ type: 'platform.install-offered' })
    shell.actor.send({ type: 'app-shell.install-button' })
    await waitFor(shell.actor, (state) => state.matches('ready'))

    expect(shell.emitted.at(-1)).toEqual({ type: 'clear', anchor: 'app-shell.install-message' })
  })

  it('takes no install around a crash, while the data opens or once it failed to', () => {
    const crashed = frame()

    crashed.actor.send({ type: 'platform.opened' })
    crashed.actor.send({ type: 'platform.crashed' })

    expect(crashed.actor.getSnapshot().can({ type: 'app-shell.install-button' })).toBe(false)
    expect(crashed.actor.getSnapshot().can({ type: 'platform.install-offered' })).toBe(false)
    expect(frame().actor.getSnapshot().can({ type: 'platform.install-offered' })).toBe(false)
  })
})
