import { errAsync, type ResultAsync } from 'neverthrow'
import { createContext, useContext } from 'react'
import type { ActorRefFrom } from 'xstate'

import type { DeviceInstall } from '../../../../platform/install'
import type { SettingsWrites, SettingWriting } from '../../../../platform/settings-writes'
import type { Theme } from '../../../../platform/theme'
import type { FrameWrites, SettingWrites } from '../../application/setting-writes'
import { createShellMachine, type SelfReloads } from '../../application/shell.machine'

/** What the frame's machine reads when it asks, kept by whoever knows it: the start, then the shell. */
export interface ShellLive {
  /** The account signed in on this device; none for a guest. */
  account: string | undefined
  /** The account's settings as this tab holds them; none before they arrive. */
  stored: { readonly locale: string } | undefined
  /** What this tab knows of each stored setting and of its own writes on their way. */
  writes: FrameWrites
  /** Moves on each time the account changes: what this tab wrote before was the earlier one's. */
  generation: number
  /** Signs the saved account out on this device, when its data did not open. */
  signOutHere: (() => ResultAsync<unknown, unknown>) | undefined
  /** Renders the screen that failed again, kept by the crash put in its place; none before one. */
  renderAgain: (() => void) | undefined
  /** Whether a field holds unsaved input now, kept by the shell. */
  unsaved: boolean
}

const SELF_RELOADED = 'perch.update.reloaded'

/**
 * The updates this tab loaded the page again for by itself, one per line in the tab's own
 * storage, which outlives its reloads: a server still serving one of them afterwards starts no
 * loop. Read only once the frame is open, so a browser that keeps no site data never reaches it.
 */
export function tabSelfReloads(storage: () => Pick<Storage, 'getItem' | 'setItem'>): SelfReloads {
  const reloaded = (): string[] => storage().getItem(SELF_RELOADED)?.split('\n') ?? []

  return {
    done: (update) => reloaded().includes(update),
    mark: (update) => storage().setItem(SELF_RELOADED, [...reloaded(), update].join('\n')),
  }
}

/** What the frame's machine acts through besides what it reads: the device's own services. */
export interface ShellFrameDeps {
  /** Where a theme chosen goes: the device's. */
  readonly setTheme: (theme: Theme) => void
  /** Installing the app on this device. */
  readonly install: Pick<DeviceInstall, 'prompt' | 'postpone'>
  /** Loads the page again; the browser's own reload by default. */
  readonly reload?: () => void
  readonly selfReloads?: SelfReloads
}

/** The frame's machine over what it reads, made at the start, before the services exist. */
export function shellFrameMachine(live: ShellLive, deps: ShellFrameDeps) {
  return createShellMachine({
    values: () => live,
    signOutHere: () =>
      live.signOutHere?.() ?? errAsync(new Error('no saved account to sign out here')),
    reload: deps.reload ?? (() => window.location.reload()),
    setTheme: deps.setTheme,
    selfReloads: deps.selfReloads ?? tabSelfReloads(() => window.sessionStorage),
    install: deps.install,
  })
}

/**
 * This tab's own writes of one setting over the frame's record, which `of` reads and `put` replaces
 * in it: a write joins the record of the account it began for, and its failure leaves that record
 * alone once the account changed.
 */
function frameWriting<T extends string>(
  live: ShellLive,
  of: (writes: FrameWrites) => SettingWrites<T>,
  put: (writes: FrameWrites, setting: SettingWrites<T>) => FrameWrites,
): SettingWriting<T> {
  return {
    writing: (value) => {
      const generation = live.generation

      live.writes = put(live.writes, of(live.writes).writing(value))

      return () => {
        if (live.generation === generation) {
          live.writes = put(live.writes, of(live.writes).failed(value))
        }
      }
    },
  }
}

/** This tab's own writes of each setting the frame follows, over the frame's record. */
export function frameSettingsWrites(live: ShellLive): SettingsWrites {
  return {
    locale: frameWriting(
      live,
      (writes) => writes.locale,
      (writes, locale) => ({ ...writes, locale }),
    ),
  }
}

export interface ShellFrame {
  readonly actor: ActorRefFrom<ReturnType<typeof shellFrameMachine>>
  readonly live: ShellLive
}

export const ShellFrameContext = createContext<ShellFrame | undefined>(undefined)

/** The frame the start made; the shell runs only inside it. */
export function useShellFrame(): ShellFrame {
  const frame = useContext(ShellFrameContext)

  if (!frame) {
    throw new Error('the shell runs inside the frame the start made')
  }

  return frame
}
