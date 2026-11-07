import type { ErrorPart } from './events'

/**
 * The effects of the screen's flow, as its transitions list them: a `show` of the codes an anchor
 * may carry, or of a toast, which `contract:flow organisation` prints and
 * `platform/machines.spec.ts` compares exactly.
 */

export const CREATE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.create.error',
    codes: ['key-invalid', 'name-required', 'name-too-long', 'key-taken', 'rate-limited', 'failed'],
  },
} as const
export const NOTE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.notes.error',
    codes: ['forbidden', 'text-required', 'text-too-long', 'failed'],
  },
} as const
export const DELETE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.notes.error', codes: ['forbidden', 'failed'] },
} as const
/** The toasts the contract derives for the changes of the notes, the organisations and their members. */
const toast = <Code extends string>(code: Code) =>
  ({ type: 'show', params: { anchor: 'app-shell.toast', codes: [code] } }) as const

export const NOTE_CREATED = toast('note-created')
export const NOTE_UPDATED = toast('note-updated')
export const NOTE_DELETED = toast('note-deleted')
export const ORGANISATION_CREATED = toast('organisation-created')
export const MEMBER_REMOVED = toast('member-removed')
export const INVITED = toast('invited')
export const INVITE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.invite.error',
    codes: ['no-such-identity', 'already-member', 'not-admin', 'rate-limited', 'failed'],
  },
} as const
export const REMOVE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['not-admin', 'failed'] },
} as const

/** Forgets the error of a part once a change of that part was done. */
export const forget = (part: ErrorPart) => ({ type: 'forget', params: { part } }) as const
