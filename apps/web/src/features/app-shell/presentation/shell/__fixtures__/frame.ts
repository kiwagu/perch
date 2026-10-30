import { createActor } from 'xstate'

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
}

/** In memory, the updates a tab loaded the page again for by itself. */
function memorySelfReloads(): SelfReloads {
  const done = new Set<string>()

  return { done: (update) => done.has(update), mark: (update) => void done.add(update) }
}

/** The frame the start makes, already opened: what a page test renders the shell container in. */
export function openedFrame(options: OpenedFrameOptions = {}): ShellFrame {
  const live: ShellLive = {
    account: undefined,
    stored: undefined,
    writes: LocaleWrites.none,
    generation: 0,
    signOutHere: undefined,
    renderAgain: undefined,
    unsaved: false,
  }
  const actor = createActor(
    shellFrameMachine(
      live,
      options.setTheme ?? (() => {}),
      options.reload ?? (() => {}),
      options.selfReloads ?? memorySelfReloads(),
    ),
  ).start()

  actor.send({ type: 'platform.opened' })

  return { actor, live }
}
