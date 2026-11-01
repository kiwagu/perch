import { createActor } from 'xstate'

import type { DeviceInstall } from '../../../../../platform/install'
import type { Theme } from '../../../../../platform/theme'
import { LocaleWrites } from '../../../application/locale-writes'
import type { SelfReloads } from '../../../application/shell.machine'
import { type ShellFrame, type ShellLive, shellFrameMachine } from '../shell-frame'

export interface OpenedFrameOptions {
  /** Where a theme chosen in the frame goes. */
  readonly setTheme?: (theme: Theme) => void
  /** What loads the page again; nothing by default. */
  readonly reload?: () => void
  /** The updates the tab loaded the page again for by itself; none by default, kept in memory. */
  readonly selfReloads?: SelfReloads
  /** Installing the app; a browser that offers no window by default. */
  readonly install?: Pick<DeviceInstall, 'prompt' | 'postpone'>
}

/** In memory, the updates a tab loaded the page again for by itself. */
function memorySelfReloads(): SelfReloads {
  const done = new Set<string>()

  return { done: (update) => done.has(update), mark: (update) => void done.add(update) }
}

/** The frame the start makes, already opened: what a page test renders the shell container in. */
export function openedFrame(options: OpenedFrameOptions = {}): ShellFrame {
  return startedFrame(undefined, options)
}

/** The frame of `account`, signed in on this device, started while its data still opens. */
export function openingFrame(account: string, options: OpenedFrameOptions = {}): ShellFrame {
  return startedFrame(account, options)
}

/** The frame the start makes, started: a guest's ready, a signed-in account's opening its data. */
function startedFrame(account: string | undefined, options: OpenedFrameOptions): ShellFrame {
  const live: ShellLive = {
    account,
    stored: undefined,
    writes: LocaleWrites.none,
    generation: 0,
    signOutHere: undefined,
    renderAgain: undefined,
    unsaved: false,
  }
  const actor = createActor(
    shellFrameMachine(live, {
      setTheme: options.setTheme ?? (() => {}),
      reload: options.reload ?? (() => {}),
      selfReloads: options.selfReloads ?? memorySelfReloads(),
      install: options.install ?? {
        prompt: () => Promise.reject(new Error('no window to install the app in this test')),
        postpone: () => {},
      },
    }),
  ).start()

  actor.send({ type: 'platform.started' })

  return { actor, live }
}
