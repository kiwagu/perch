import {
  forget,
  INVITE_REFUSED,
  INVITED,
  MEMBER_REMOVED,
  NOTE_CREATED,
  NOTE_REFUSED,
  REMOVE_REFUSED,
} from './effects'
import { taken } from './events'

/**
 * The regions of the screen's flow that wait for the one action a button runs (`by` a button in
 * the contract): idle until the button is pressed, running until its action ends. A done change
 * forgets the error of its part and says itself in a toast; the changes of the members count so
 * the members are read again.
 */

/** Invites an email: the invitation is mailed. */
export const INVITE_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'organisation.invite.submit-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.organisations.invite',
        input: taken('organisation.invite.submit-button'),
        onDone: { target: 'idle', actions: [forget('members'), 'reread', INVITED] },
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
          actions: [forget('members'), 'reread', MEMBER_REMOVED],
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
