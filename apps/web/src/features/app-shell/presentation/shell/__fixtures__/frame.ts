import { createActor } from 'xstate'

import { LocaleWrites } from '../../../application/locale-writes'
import { type ShellFrame, type ShellLive, shellFrameMachine } from '../shell-frame'

/** The frame the start makes, already opened: what a page test renders the shell container in. */
export function openedFrame(): ShellFrame {
  const live: ShellLive = {
    account: undefined,
    stored: undefined,
    writes: LocaleWrites.none,
    signOutHere: undefined,
    renderAgain: undefined,
  }
  const actor = createActor(shellFrameMachine(live)).start()

  actor.send({ type: 'platform.opened' })

  return { actor, live }
}
