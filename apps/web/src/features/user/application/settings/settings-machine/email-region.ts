import { assertEvent } from 'xstate'

import { EMAIL_ERROR, EMAIL_MESSAGE } from './anchors'
import type { SettingsEvent } from './events'

/** The new email and the current password the send button sent. */
function emailInput({ event }: { readonly event: SettingsEvent }): {
  readonly email: string
  readonly password: string
} {
  assertEvent(event, 'user.settings.email.send-button')

  return { email: event.email, password: event.password }
}

/**
 * The region of the screen's flow that asks to change the account's email: the send button sends
 * the mail to the new email, the message asks to open its link once it went out, a refusal says
 * why, and the button sends it again as often as it is pressed.
 */
export const EMAIL_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: { 'user.settings.email.send-button': { target: 'sending' } },
    },
    sending: {
      entry: [{ type: 'clear', params: { anchor: EMAIL_ERROR } }],
      invoke: {
        src: 'platform.change-email',
        input: emailInput,
        onDone: {
          target: 'sent',
          actions: [
            { type: 'show', params: { anchor: EMAIL_MESSAGE, codes: ['check-your-mail'] } },
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            { type: 'clear', params: { anchor: EMAIL_MESSAGE } },
            {
              type: 'show',
              params: {
                anchor: EMAIL_ERROR,
                codes: ['invalid-credentials', 'email-invalid', 'rate-limited', 'failed'],
              },
            },
          ],
        },
      },
    },
    sent: {
      on: { 'user.settings.email.send-button': { target: 'sending' } },
    },
  },
} as const
