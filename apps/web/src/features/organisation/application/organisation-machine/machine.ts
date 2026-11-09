import { okAsync, type ResultAsync } from 'neverthrow'
import { assertEvent, assign, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { IdentityId, InvitationId, NoteId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import { failureOf } from '../../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../../platform/flow-effects'

import {
  INVITE_REGION,
  MEMBERS_REGION,
  NOTES_ADD_REGION,
  RECEIVED_DECLINE_REGION,
  SENT_COPY_REGION,
  SENT_REVOKE_REGION,
} from './button-regions'
import { CREATE_FORM_REGION } from './create-form-region'
import {
  type ErrorPart,
  type OrganisationContext,
  type OrganisationEmitted,
  type OrganisationEvent,
  type OrganisationMachineDeps,
  taken,
} from './events'
import { MEMBER_ROLES_REGION } from './member-roles-region'
import { NOTE_ITEMS_REGION } from './note-items-region'
import { RECEIVED_REGION } from './received-region'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'organisation:UNKNOWN'

/** The page's own errors, by their anchors: the machine keeps the code each shows for the view. */
const ERROR_PARTS: Readonly<Record<string, ErrorPart>> = {
  'organisation.create.error': 'create',
  'organisation.notes.error': 'notes',
  'organisation.invite.error': 'members',
  'organisation.received.error': 'received',
}

/** The organisation a write ran in, which its outcome carries: the one current when it started. */
interface Origin {
  readonly of: string | undefined
}

/** The organisation a write's outcome carries, read off the done or error event of its invoke. */
function originOf(event: object): string | undefined {
  const outcome = 'output' in event ? event.output : 'error' in event ? event.error : undefined

  return typeof outcome === 'object' &&
    outcome !== null &&
    'of' in outcome &&
    typeof outcome.of === 'string'
    ? outcome.of
    : undefined
}

/**
 * The organisation page as the screen's flow says (`contract/domain/screens/org.yaml`): the create
 * form, the notes' items, the invitation, the members and their roles, the invitations sent and
 * for the account, and the new note are the regions of `viewing`; choosing another organisation,
 * creating one or accepting an invitation starts them all afresh. One note is edited at a time,
 * the one acted on last, and one role is changed at a time. A control is enabled while a state
 * handles its event (`snapshot.can`). Its `show` keeps the code of the page's own errors for the
 * view and emits any other; its `clear` is emitted for the host to empty a field.
 */
export function createOrganisationMachine(deps: OrganisationMachineDeps) {
  /**
   * A write of the page as an invoke, in the organisation current when it starts: it resolves
   * with that organisation once done, or rejects with its failure and that organisation, so a
   * late outcome is kept away from another organisation that became current meanwhile.
   */
  const write = <I>(run: (input: I) => ResultAsync<unknown, BusError>) =>
    fromPromise<Origin, I>(async ({ input }) => {
      const of = deps.current()
      const outcome = await run(input)

      return outcome.isOk() ? { of } : Promise.reject({ ...outcome.error, of })
    })

  return setup({
    types: {
      context: {} as OrganisationContext,
      events: {} as OrganisationEvent,
      emitted: {} as OrganisationEmitted,
    },
    actors: {
      // Choosing applies at once: the session makes the organisation current on this device.
      'platform.organisations.select': write(({ key }: { readonly key: string }) => {
        deps.select(key)

        return okAsync(undefined)
      }),
      'platform.organisations.create': write(deps.create),
      'note.updateNote': write(deps.editNote),
      'note.deleteNote': write(({ id }: { readonly id: NoteId }) => deps.deleteNote(id)),
      'note.createNote': write(({ text }: { readonly text: string }) => deps.addNote(text)),
      'platform.organisations.invite': write(
        ({ email, role }: { readonly email: string; readonly role: TenantRole }) =>
          deps.invite(email, role),
      ),
      'platform.organisations.set-role': write(
        ({ identity, role }: { readonly identity: IdentityId; readonly role: TenantRole }) =>
          deps.setRole({ identity, role }),
      ),
      'platform.organisations.remove': write(({ identity }: { readonly identity: IdentityId }) =>
        deps.remove(identity),
      ),
      'platform.organisations.copy-invitation': write(
        ({ invitation }: { readonly invitation: InvitationId }) => deps.copy(invitation),
      ),
      'platform.organisations.revoke-invitation': write(
        ({ invitation }: { readonly invitation: InvitationId }) => deps.revoke(invitation),
      ),
      'platform.invitations.accept': write(
        ({ invitation }: { readonly invitation: InvitationId }) => deps.accept(invitation),
      ),
      'platform.invitations.decline': write(
        ({ invitation }: { readonly invitation: InvitationId }) => deps.decline(invitation),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event, context }, params: ShowParams) => {
        const part = ERROR_PARTS[params.anchor]

        if (part === undefined) {
          enqueue.emit({ type: 'show', ...params })

          return
        }

        const of = originOf(event)

        // A failure in an organisation no longer current is not this page's to show.
        if (of !== deps.current()) {
          return
        }

        const kept = context.errors.of === of ? context.errors.codes : {}

        enqueue.assign({
          errors: { of, codes: { ...kept, [part]: failureOf(event, UNKNOWN_FAILURE) } },
        })
      }),
      // A change done in another organisation leaves the errors of this one as they are.
      forget: assign(({ context, event }, params: { readonly part: ErrorPart }) =>
        originOf(event) === context.errors.of
          ? {
              errors: {
                ...context.errors,
                codes: { ...context.errors.codes, [params.part]: undefined },
              },
            }
          : {},
      ),
      // A field of the page is emptied by the host, which holds what it shows: the fields of the
      // organisation current now, so a write made in another one leaves them as typed.
      clear: enqueueActions(({ enqueue, event }, params: ClearParams) => {
        if (originOf(event) !== deps.current()) {
          return
        }

        enqueue.emit({ type: 'clear', ...params })
      }),
      startAfresh: assign({
        errors: { of: undefined, codes: {} },
        editing: undefined,
        changingRole: undefined,
        rolesSet: [],
      }),
      open: assign({
        editing: ({ event }) => {
          assertEvent(event, 'organisation.notes.edit-button')

          return event.id
        },
      }),
      rereadMembers: assign({ membersChanged: ({ context }) => context.membersChanged + 1 }),
      rereadInvitations: assign({
        invitationsChanged: ({ context }) => context.invitationsChanged + 1,
      }),
      rereadReceived: assign({ receivedChanged: ({ context }) => context.receivedChanged + 1 }),
      // The account's own demotion leaves the members list: read as a member, it would be refused,
      // and no row is left to show the role. Otherwise the members are read again, and the row
      // keeps the role just set until that read settles (not for a change made in another
      // organisation, whose rows are not these).
      rereadAfterRole: assign(({ context, event }) => {
        const { changingRole, membersChanged, rolesSet } = context
        const demotedItself =
          changingRole?.role === 'member' && changingRole.identity === deps.account()

        if (demotedItself) {
          return {}
        }

        const read = membersChanged + 1
        const remembered =
          changingRole !== undefined && originOf(event) === deps.current()
            ? [
                ...rolesSet.filter((set) => set.identity !== changingRole.identity),
                { ...changingRole, read },
              ]
            : rolesSet

        return { membersChanged: read, rolesSet: remembered }
      }),
      startChanging: assign({
        changingRole: ({ event }) => {
          assertEvent(event, 'organisation.members.role-select')

          return { identity: event.identity, role: event.role, of: deps.current() }
        },
      }),
      settleRole: assign({ changingRole: undefined }),
    },
  }).createMachine({
    id: 'organisation',
    initial: 'viewing',
    context: {
      errors: { of: undefined, codes: {} },
      editing: undefined,
      membersChanged: 0,
      invitationsChanged: 0,
      receivedChanged: 0,
      changingRole: undefined,
      rolesSet: [],
    },
    states: {
      viewing: {
        type: 'parallel',
        entry: 'startAfresh',
        on: { 'organisation.page.current-select': { target: 'selecting' } },
        states: {
          'create-form': CREATE_FORM_REGION,
          'note-items': NOTE_ITEMS_REGION,
          invite: INVITE_REGION,
          members: MEMBERS_REGION,
          'member-roles': MEMBER_ROLES_REGION,
          'sent-copy': SENT_COPY_REGION,
          'sent-revoke': SENT_REVOKE_REGION,
          received: RECEIVED_REGION,
          'received-decline': RECEIVED_DECLINE_REGION,
          'notes-add': NOTES_ADD_REGION,
        },
      },
      selecting: {
        invoke: {
          src: 'platform.organisations.select',
          input: taken('organisation.page.current-select'),
          onDone: { target: 'viewing' },
        },
      },
    },
  })
}
