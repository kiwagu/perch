import { assertEvent } from 'xstate'

import { DELETION_ERROR, DELETION_MESSAGE } from './anchors'
import type { SettingsEvent } from './events'

/** The current password the send button sent, which confirms the request. */
function deletionInput({ event }: { readonly event: SettingsEvent }): {
  readonly password: string
} {
  assertEvent(event, 'user.settings.deletion.send-button')

  return { password: event.password }
}

/**
 * The region of the screen's flow that asks to delete the account: the send button mails the link
 * of the page that deletes it, and the account stays as it is until that page's button is pressed.
 * Once the mail went out the message says so and the password is emptied; a refusal says why and
 * keeps the password as typed. The button sends a fresh link as often as it is pressed.
 */
export const DELETION_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: { 'user.settings.deletion.send-button': { target: 'sending' } },
    },
    sending: {
      entry: [{ type: 'clear', params: { anchor: DELETION_ERROR } }],
      invoke: {
        src: 'platform.request-account-deletion',
        input: deletionInput,
        onDone: {
          target: 'sent',
          actions: [
            { type: 'show', params: { anchor: DELETION_MESSAGE, codes: ['check-your-mail'] } },
            { type: 'clear', params: { anchor: 'user.settings.deletion.password-input' } },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            { type: 'clear', params: { anchor: DELETION_MESSAGE } },
            {
              type: 'show',
              params: {
                anchor: DELETION_ERROR,
                codes: ['invalid-credentials', 'last-admin', 'rate-limited', 'failed'],
              },
            },
          ],
        },
      },
    },
    sent: {
      on: { 'user.settings.deletion.send-button': { target: 'sending' } },
    },
  },
} as const
