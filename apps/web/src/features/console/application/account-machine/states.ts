import { assertEvent } from 'xstate'

import {
  ACCOUNT_REMOVED,
  BAN_LIFTED,
  BAN_REFUSED,
  BAN_SET,
  CLEAR_EMAIL,
  CLEAR_REASON,
  EMAIL_CHANGE_SENT,
  EMAIL_REFUSED,
  forget,
  NAME_SAVED,
  READ_SECTION,
  REMOVE_REFUSED,
  RENAME_REFUSED,
  RESEND_REFUSED,
  RESET_REFUSED,
  RESET_SENT,
  REVOKE_REFUSED,
  SESSIONS_REVOKED,
  TO_ACCOUNTS,
  UNBAN_REFUSED,
  VERIFICATION_SENT,
} from './effects'

/**
 * The events of the card's flow: the controls of its areas, the forms' with what their fields
 * hold when they are sent.
 */
export type AccountEvent =
  | { readonly type: 'console.account.name.save-button'; readonly name: string }
  | { readonly type: 'console.account.email.send-button'; readonly email: string }
  | { readonly type: 'console.account.ban.ban-button'; readonly reason: string }
  | { readonly type: 'console.account.ban.unban-button' }
  | { readonly type: 'console.account.sessions.revoke-button' }
  | { readonly type: 'console.account.reset.send-button' }
  | { readonly type: 'console.account.verification.resend-button' }
  | { readonly type: 'console.account.removal.remove-button' }

/** The name the name form sent. */
function nameInput({ event }: { readonly event: AccountEvent }): { readonly name: string } {
  assertEvent(event, 'console.account.name.save-button')

  return { name: event.name }
}

/** The new email the email form sent. */
function emailInput({ event }: { readonly event: AccountEvent }): { readonly email: string } {
  assertEvent(event, 'console.account.email.send-button')

  return { email: event.email }
}

/** The reason the ban form sent, empty for none. */
function reasonInput({ event }: { readonly event: AccountEvent }): { readonly reason: string } {
  assertEvent(event, 'console.account.ban.ban-button')

  return { reason: event.reason }
}

/**
 * The areas of the card's flow (`contract/domain/screens/console/account.yaml`), the regions of
 * `viewing`: each idle until its control is pressed, running its action on the account until it
 * ends. A done action forgets its area's error, says itself in a toast and reads the card again; a
 * refused one shows its code in its area's error and reads the card again, since what it shows may
 * have changed meanwhile. A removal done leaves the card for the accounts.
 */

/** Renames the account's profile. */
export const NAME_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.name.save-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.rename',
        input: nameInput,
        onDone: { target: 'idle', actions: [forget('name'), READ_SECTION, NAME_SAVED] },
        onError: { target: 'idle', actions: [RENAME_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Asks to change the account's email: the field empties once the mail is on its way. */
export const EMAIL_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.email.send-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.change-email',
        input: emailInput,
        onDone: {
          target: 'idle',
          actions: [forget('email'), CLEAR_EMAIL, READ_SECTION, EMAIL_CHANGE_SENT],
        },
        onError: { target: 'idle', actions: [EMAIL_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Bans the account with the reason typed, which empties once it is banned, or lifts its ban. */
export const BAN_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: {
        'console.account.ban.ban-button': { target: 'banning' },
        'console.account.ban.unban-button': { target: 'unbanning' },
      },
    },
    banning: {
      invoke: {
        src: 'platform.accounts.ban',
        input: reasonInput,
        onDone: { target: 'idle', actions: [forget('ban'), CLEAR_REASON, READ_SECTION, BAN_SET] },
        onError: { target: 'idle', actions: [BAN_REFUSED, READ_SECTION] },
      },
    },
    unbanning: {
      invoke: {
        src: 'platform.accounts.unban',
        onDone: { target: 'idle', actions: [forget('ban'), READ_SECTION, BAN_LIFTED] },
        onError: { target: 'idle', actions: [UNBAN_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Signs every device of the account out. */
export const SESSIONS_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.sessions.revoke-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.revoke-sessions',
        onDone: { target: 'idle', actions: [forget('sessions'), READ_SECTION, SESSIONS_REVOKED] },
        onError: { target: 'idle', actions: [REVOKE_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Sends the account a password reset. */
export const RESET_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.reset.send-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.send-reset',
        onDone: { target: 'idle', actions: [forget('reset'), READ_SECTION, RESET_SENT] },
        onError: { target: 'idle', actions: [RESET_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Sends the account its verification mail again. */
export const VERIFICATION_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.verification.resend-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.resend-verification',
        onDone: {
          target: 'idle',
          actions: [forget('verification'), READ_SECTION, VERIFICATION_SENT],
        },
        onError: { target: 'idle', actions: [RESEND_REFUSED, READ_SECTION] },
      },
    },
  },
} as const

/** Removes the account for good: the card ends and the app moves to the accounts. */
export const REMOVAL_REGION = {
  initial: 'idle',
  states: {
    idle: { on: { 'console.account.removal.remove-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'platform.accounts.remove',
        onDone: { target: '#account.removed', actions: [TO_ACCOUNTS, ACCOUNT_REMOVED] },
        onError: { target: 'idle', actions: [REMOVE_REFUSED, READ_SECTION] },
      },
    },
  },
} as const
