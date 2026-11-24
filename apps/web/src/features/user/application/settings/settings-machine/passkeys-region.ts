import { assertEvent } from 'xstate'

import { PASSKEYS_ERROR, PASSKEYS_LIST } from './anchors'
import type { SettingsEvent } from './events'

/** The id of the passkey the press on its row named. */
function removalInput({ event }: { readonly event: SettingsEvent }) {
  assertEvent(event, 'user.settings.passkeys.remove-button')

  return { passkey: event.passkey }
}

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: PASSKEYS_ERROR, codes } }) as const
const clearError = { type: 'clear', params: { anchor: PASSKEYS_ERROR } } as const
const readList = { type: 'read', params: { anchor: PASSKEYS_LIST } } as const
const toast = (code: string) =>
  ({ type: 'show', params: { anchor: 'app-shell.toast', codes: [code] } }) as const

/**
 * The region of the screen's flow that adds a passkey: the browser makes it (its window is open
 * while the region runs, so a second press is not taken), and the list is read again once it is
 * kept. A window closed, or any other failure, adds nothing and says why.
 */
export const PASSKEY_ADD_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'user.settings.passkeys.add-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.passkeys.add',
        onDone: { target: 'idle', actions: [clearError, readList, toast('passkey-added')] },
        onError: { target: 'idle', actions: [showError('passkey-cancelled', 'failed')] },
      },
    },
  },
} as const

/**
 * The region that removes the passkey of the row pressed, after the frame's confirmation, and
 * reads the list again whatever came of it: a removal that failed (the passkey went from another
 * device meanwhile, say) says so over the list as it is now.
 */
export const PASSKEY_REMOVE_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'user.settings.passkeys.remove-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.passkeys.remove',
        input: removalInput,
        onDone: { target: 'idle', actions: [clearError, readList, toast('passkey-removed')] },
        onError: { target: 'idle', actions: [showError('failed'), readList] },
      },
    },
  },
} as const
