import { createActor } from 'xstate'

import type { Theme } from '../../../../../platform/theme'
import { LocaleWrites } from '../../../application/locale-writes'
import { type ShellFrame, type ShellLive, shellFrameMachine } from '../shell-frame'

/**
 * The frame the start makes, already opened: what a page test renders the shell container in; a
 * theme chosen in it goes to `setTheme`.
 */
export function openedFrame(setTheme: (theme: Theme) => void = () => {}): ShellFrame {
  const live: ShellLive = {
    account: undefined,
    stored: undefined,
    writes: LocaleWrites.none,
    generation: 0,
    signOutHere: undefined,
    renderAgain: undefined,
  }
  const actor = createActor(shellFrameMachine(live, setTheme)).start()

  actor.send({ type: 'platform.opened' })

  return { actor, live }
}
