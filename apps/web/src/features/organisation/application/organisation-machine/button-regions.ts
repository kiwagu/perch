import {
  CLEAR_EMAIL,
  CLEAR_ROLE,
  COPY_REFUSED,
  DECLINE_REFUSED,
  forget,
  INVITATION_DECLINED,
  INVITATION_REVOKED,
  INVITE_REFUSED,
  INVITED,
  LINK_COPIED,
  MEMBER_REMOVED,
  NOTE_CREATED,
  NOTE_REFUSED,
  READ_MEMBERS,
  READ_RECEIVED,
  READ_SENT,
  REMOVE_REFUSED,
  REVOKE_REFUSED,
} from './effects'
import { taken } from './events'

/**
 * The regions of the screen's flow that wait for the one action a button runs (`by` a button in
 * the contract): idle until the button is pressed, running until its action ends. A done change
 * forgets the error of its part and says itself in a toast, and reads again the list it changed
 * (`read`), as its flow says.
 */

/** Invites an email: the invitation is mailed and the form's fields empty. */
export const INVITE_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.invite.submit-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.organisations.invite',
        input: taken('organisation.invite.submit-button'),
        onDone: {
          target: 'idle',
          actions: [CLEAR_EMAIL, CLEAR_ROLE, forget('members'), READ_SENT, INVITED],
        },
        onError: { target: 'idle', actions: [INVITE_REFUSED] },
      },
    },
  },
} as const

/** Removes a member. */
export const MEMBERS_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.members.remove-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.organisations.remove',
        input: taken('organisation.members.remove-button'),
        onDone: {
          target: 'idle',
          actions: [forget('members'), READ_MEMBERS, MEMBER_REMOVED],
        },
        onError: { target: 'idle', actions: [REMOVE_REFUSED] },
      },
    },
  },
} as const

/** Adds the new note. */
export const NOTES_ADD_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.notes.add-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'note.createNote',
        input: taken('organisation.notes.add-button'),
        onDone: { target: 'idle', actions: [forget('notes'), NOTE_CREATED] },
        onError: { target: 'idle', actions: [NOTE_REFUSED] },
      },
    },
  },
} as const

/** Puts the link of a pending invitation on the clipboard. */
export const SENT_COPY_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.sent.copy-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.organisations.copy-invitation',
        input: taken('organisation.sent.copy-button'),
        onDone: { target: 'idle', actions: [forget('members'), LINK_COPIED] },
        onError: { target: 'idle', actions: [COPY_REFUSED] },
      },
    },
  },
} as const

/** Revokes a pending invitation: the invitations are read again. */
export const SENT_REVOKE_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.sent.revoke-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.organisations.revoke-invitation',
        input: taken('organisation.sent.revoke-button'),
        onDone: {
          target: 'idle',
          actions: [forget('members'), READ_SENT, INVITATION_REVOKED],
        },
        onError: { target: 'idle', actions: [REVOKE_REFUSED] },
      },
    },
  },
} as const

/** Declines an invitation for the account: the invitations for it are read again, refused or not. */
export const RECEIVED_DECLINE_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.received.decline-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.invitations.decline',
        input: taken('organisation.received.decline-button'),
        onDone: {
          target: 'idle',
          actions: [forget('received'), READ_RECEIVED, INVITATION_DECLINED],
        },
        onError: { target: 'idle', actions: [DECLINE_REFUSED, READ_RECEIVED] },
      },
    },
  },
} as const
