import { okAsync, type ResultAsync } from 'neverthrow'
import { assertEvent, assign, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { IdentityId, NoteId } from '@workspace/ids'

import { failureOf } from '../../../../platform/actor-outcome'
import type { ShowParams } from '../../../../platform/flow-effects'

import { INVITE_REGION, MEMBERS_REGION, NOTES_ADD_REGION } from './button-regions'
import { CREATE_FORM_REGION } from './create-form-region'
import {
  type ErrorPart,
  type OrganisationContext,
  type OrganisationEmitted,
  type OrganisationEvent,
  type OrganisationMachineDeps,
  taken,
} from './events'
import { NOTE_ITEMS_REGION } from './note-items-region'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'organisation:UNKNOWN'

/** The page's own errors, by their anchors: the machine keeps the code each shows for the view. */
const ERROR_PARTS: Readonly<Record<string, ErrorPart>> = {
  'organisation.create.error': 'create',
  'organisation.notes.error': 'notes',
  'organisation.invite.error': 'members',
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
 * form, the notes' items, the invitation, the members and the new note are the regions of
 * `viewing`, choosing another organisation or creating one starts them all afresh. One note is
 * edited at a time, the one acted on last. A control is enabled while a state handles its event
 * (`snapshot.can`). Its `show` keeps the code of the page's own errors for the view and emits
 * any other.
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
      'platform.organisations.invite': write(({ email }: { readonly email: string }) =>
        deps.invite(email),
      ),
      'platform.organisations.remove': write(({ identity }: { readonly identity: IdentityId }) =>
        deps.remove(identity),
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
      startAfresh: assign({ errors: { of: undefined, codes: {} }, editing: undefined }),
      open: assign({
        editing: ({ event }) => {
          assertEvent(event, 'organisation.notes.edit-button')

          return event.id
        },
      }),
      reread: assign({ membersChanged: ({ context }) => context.membersChanged + 1 }),
    },
  }).createMachine({
    id: 'organisation',
    initial: 'viewing',
    context: { errors: { of: undefined, codes: {} }, editing: undefined, membersChanged: 0 },
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
