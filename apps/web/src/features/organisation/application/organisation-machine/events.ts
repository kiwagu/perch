import type { ResultAsync } from 'neverthrow'
import { assertEvent } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { IdentityId, InvitationId, NoteId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import type { ClearParams, ShowParams } from '../../../../platform/flow-effects'

export type { TenantRole }

/** The codes of the last refused changes, by the part of the page that asked for them. */
export interface OrganisationErrors {
  readonly create?: string | undefined
  readonly notes?: string | undefined
  readonly members?: string | undefined
  readonly received?: string | undefined
}

export type ErrorPart = keyof OrganisationErrors

export interface OrganisationContext {
  /**
   * The codes of the last refused changes, and the organisation they were refused in: another
   * organisation that becomes current without the page choosing it (a membership removed on
   * another device) shows none of them.
   */
  readonly errors: { readonly of: string | undefined; readonly codes: OrganisationErrors }
  /** The note whose edit form is open while the notes' items edit: the one acted on last. */
  readonly editing: NoteId | undefined
  /** How many changes of the members were made here: the members are read again after each. */
  readonly membersChanged: number
  /** How many changes of the invitations sent were made here: they are read again after each. */
  readonly invitationsChanged: number
  /** How many invitations for the account were accepted or declined here: they are read again. */
  readonly receivedChanged: number
  /** The role being set on a member's row while its change runs: the row's select shows it. */
  readonly changingRole: { readonly identity: IdentityId; readonly role: TenantRole } | undefined
}

/** The events of the screen's flow: the anchors acted on, with what their actions take. */
export type OrganisationEvent =
  | { readonly type: 'organisation.page.current-select'; readonly key: string }
  | { readonly type: 'organisation.create.toggle-button' }
  | {
      readonly type: 'organisation.create.submit-button'
      readonly key: string
      readonly name: string
    }
  | { readonly type: 'organisation.notes.edit-button'; readonly id: NoteId }
  | { readonly type: 'organisation.notes.save-button'; readonly id: NoteId; readonly text: string }
  | { readonly type: 'organisation.notes.delete-button'; readonly id: NoteId }
  | { readonly type: 'organisation.notes.add-button'; readonly text: string }
  | {
      readonly type: 'organisation.invite.submit-button'
      readonly email: string
      readonly role: TenantRole
    }
  | { readonly type: 'organisation.members.remove-button'; readonly identity: IdentityId }
  | {
      readonly type: 'organisation.members.role-select'
      readonly identity: IdentityId
      readonly role: TenantRole
    }
  | { readonly type: 'organisation.sent.copy-button'; readonly invitation: InvitationId }
  | { readonly type: 'organisation.sent.revoke-button'; readonly invitation: InvitationId }
  | { readonly type: 'organisation.received.accept-button'; readonly invitation: InvitationId }
  | { readonly type: 'organisation.received.decline-button'; readonly invitation: InvitationId }

/**
 * What the machine asks of its host: a code shown outside the page's own errors, and a field
 * emptied.
 */
export type OrganisationEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)

/** The page's writes, each on the organisation current when it runs. */
export interface OrganisationMachineDeps {
  readonly select: (key: string) => void
  readonly create: (input: {
    readonly key: string
    readonly name: string
  }) => ResultAsync<unknown, BusError>
  readonly addNote: (text: string) => ResultAsync<void, BusError>
  readonly editNote: (input: {
    readonly id: NoteId
    readonly text: string
  }) => ResultAsync<void, BusError>
  readonly deleteNote: (id: NoteId) => ResultAsync<void, BusError>
  readonly invite: (email: string, role: TenantRole) => ResultAsync<unknown, BusError>
  readonly setRole: (input: {
    readonly identity: IdentityId
    readonly role: TenantRole
  }) => ResultAsync<void, BusError>
  readonly remove: (identity: IdentityId) => ResultAsync<void, BusError>
  readonly revoke: (invitation: InvitationId) => ResultAsync<void, BusError>
  /** Puts the link of a pending invitation on the clipboard. */
  readonly copy: (invitation: InvitationId) => ResultAsync<unknown, BusError>
  /** Accepts an invitation for the account: the organisation it is to becomes current. */
  readonly accept: (invitation: InvitationId) => ResultAsync<unknown, BusError>
  readonly decline: (invitation: InvitationId) => ResultAsync<void, BusError>
  /** The account signed in now, none once it signed out. */
  readonly account: () => IdentityId | undefined
  /** The key of the organisation current now, none without one. */
  readonly current: () => string | undefined
}

/** The event that entered the state, as the input of its invoke. */
export const taken =
  <E extends OrganisationEvent['type']>(type: E) =>
  ({ event }: { readonly event: OrganisationEvent }) => {
    assertEvent(event, type)

    return event
  }
