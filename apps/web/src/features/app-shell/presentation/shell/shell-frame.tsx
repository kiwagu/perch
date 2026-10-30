import { errAsync, type ResultAsync } from 'neverthrow'
import { createContext, useContext } from 'react'
import type { ActorRefFrom } from 'xstate'

import type { LocaleWrites } from '../../application/locale-writes'
import { createShellMachine } from '../../application/shell.machine'

/** What the frame's machine reads when it asks, kept by whoever knows it: the start, then the shell. */
export interface ShellLive {
  /** The account signed in on this device; none for a guest. */
  account: string | undefined
  /** The language the account's settings hold on this device; none before they arrive. */
  stored: string | undefined
  /** What this device knows of the stored language and of its own writes on their way. */
  writes: LocaleWrites
  /** Signs the saved account out on this device, when its data did not open. */
  signOutHere: (() => ResultAsync<unknown, unknown>) | undefined
  /** Renders the screen that failed again, kept by the crash put in its place; none before one. */
  renderAgain: (() => void) | undefined
}

/** The frame's machine over what it reads, made at the start, before the services exist. */
export function shellFrameMachine(
  live: ShellLive,
  reload: () => void = () => window.location.reload(),
) {
  return createShellMachine({
    values: () => live,
    signOutHere: () =>
      live.signOutHere?.() ?? errAsync(new Error('no saved account to sign out here')),
    reload,
  })
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
