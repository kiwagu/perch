import { ACCEPT_REFUSED, INVITATION_ACCEPTED, READ_RECEIVED } from './effects'
import { taken } from './events'

/**
 * The region of the screen's flow for the invitations for the account: accepting one makes its
 * organisation current and starts every area afresh; a refusal shows on the invitations'
 * own error. The invitations are read again once an acceptance ends, refused or not, so one
 * gone meanwhile leaves the list.
 */
export const RECEIVED_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.received.accept-button': { target: 'accepting' } } },
    accepting: {
      invoke: {
        src: 'platform.invitations.accept',
        input: taken('organisation.received.accept-button'),
        onDone: {
          target: '#organisation.viewing',
          actions: [READ_RECEIVED, INVITATION_ACCEPTED],
        },
        onError: { target: 'idle', actions: [ACCEPT_REFUSED, READ_RECEIVED] },
      },
    },
  },
} as const
