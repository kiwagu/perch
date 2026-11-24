/**
 * The effects of the screen's flow, as its transitions list them: a `show` of the codes an anchor
 * may carry, or of a toast, a `clear` of an error or of a field, a `read` of a list, which
 * `contract:flow organisation` prints and `platform/machines.spec.ts` compares exactly.
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
export const ROLE_CHANGED = toast('role-changed')
export const LINK_COPIED = toast('link-copied')
export const INVITATION_REVOKED = toast('invitation-revoked')
export const INVITATION_ACCEPTED = toast('invitation-accepted')
export const INVITATION_DECLINED = toast('invitation-declined')
export const INVITE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.invite.error',
    codes: ['already-member', 'email-invalid', 'not-admin', 'rate-limited', 'failed'],
  },
} as const
export const ROLE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['not-admin', 'last-admin', 'failed'] },
} as const
export const COPY_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['failed'] },
} as const
export const REVOKE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['not-admin', 'failed'] },
} as const
export const ACCEPT_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.received.error',
    codes: ['invitation-gone', 'other-account', 'already-member', 'failed'],
  },
} as const
export const SETTINGS_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.settings.error', codes: ['forbidden', 'failed'] },
} as const

export const DECLINE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.received.error',
    codes: ['invitation-gone', 'other-account', 'failed'],
  },
} as const

const cleared = <Anchor extends string>(anchor: Anchor) =>
  ({ type: 'clear', params: { anchor } }) as const

/** The page's errors that go once a change of their part is done. */
export const CLEAR_NOTES_ERROR = cleared('organisation.notes.error')
export const CLEAR_INVITE_ERROR = cleared('organisation.invite.error')
export const CLEAR_RECEIVED_ERROR = cleared('organisation.received.error')
export const CLEAR_SETTINGS_ERROR = cleared('organisation.settings.error')
/** The fields the invitation's form empties once it is mailed. */
export const CLEAR_EMAIL = cleared('organisation.invite.email-input')
export const CLEAR_ROLE = cleared('organisation.invite.role-select')
/** The fields the create form empties once the organisation is created. */
export const CLEAR_KEY = cleared('organisation.create.key-input')
export const CLEAR_NAME = cleared('organisation.create.name-input')
/** The field the new note is typed in, emptied once the note is written. */
export const CLEAR_NEW_NOTE = cleared('organisation.notes.new-textarea')
export const REMOVE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['not-admin', 'failed'] },
} as const

/** The page's lists its flow reads again after a change: the view reads each anew. */
export const MEMBERS_LIST = 'organisation.members.list'
export const SENT_LIST = 'organisation.sent.list'
export const RECEIVED_LIST = 'organisation.received.list'

/** The params of the flow's `read` on this page: one of its lists. */
export interface ListRead {
  readonly anchor: typeof MEMBERS_LIST | typeof SENT_LIST | typeof RECEIVED_LIST
}

export const READ_MEMBERS = { type: 'read', params: { anchor: MEMBERS_LIST } } as const
export const READ_SENT = { type: 'read', params: { anchor: SENT_LIST } } as const
export const READ_RECEIVED = { type: 'read', params: { anchor: RECEIVED_LIST } } as const
