import { okAsync, type ResultAsync } from 'neverthrow'
import { assertEvent, assign, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { IdentityId, NoteId } from '@workspace/ids'

import { failureOf, settled } from '../../../platform/actor-outcome'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'organisation:UNKNOWN'

/** The codes of the last refused changes, by the part of the page that asked for them. */
export interface OrganisationErrors {
  readonly create?: string | undefined
  readonly notes?: string | undefined
  readonly members?: string | undefined
}

type ErrorPart = keyof OrganisationErrors

/** The page's own errors, by their anchors: the machine keeps the code each shows for the view. */
const ERROR_PARTS: Readonly<Record<string, ErrorPart>> = {
  'organisation.create.error': 'create',
  'organisation.notes.error': 'notes',
  'organisation.invite.error': 'members',
}

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
  | { readonly type: 'organisation.invite.submit-button'; readonly email: string }
  | { readonly type: 'organisation.members.remove-button'; readonly identity: IdentityId }

/** The params of the flow's effect: an anchor shows one of the codes. */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

/** What the machine asks of its host: a code shown outside the page's own errors. */
export type OrganisationEmitted = { readonly type: 'show' } & ShowParams

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
  readonly invite: (email: string) => ResultAsync<unknown, BusError>
  readonly remove: (identity: IdentityId) => ResultAsync<void, BusError>
  /** The key of the organisation current now, none without one. */
  readonly current: () => string | undefined
}

const CREATE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.create.error',
    codes: ['key-invalid', 'name-required', 'name-too-long', 'key-taken', 'rate-limited', 'failed'],
  },
} as const
const NOTE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.notes.error',
    codes: ['forbidden', 'text-required', 'text-too-long', 'failed'],
  },
} as const
const DELETE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.notes.error', codes: ['forbidden', 'failed'] },
} as const
const INVITED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['invited'] },
} as const
const INVITE_REFUSED = {
  type: 'show',
  params: {
    anchor: 'organisation.invite.error',
    codes: ['no-such-identity', 'already-member', 'not-admin', 'rate-limited', 'failed'],
  },
} as const
const REMOVE_REFUSED = {
  type: 'show',
  params: { anchor: 'organisation.invite.error', codes: ['not-admin', 'failed'] },
} as const

/** Forgets the error of a part once a change of that part was done. */
const forget = (part: ErrorPart) => ({ type: 'forget', params: { part } }) as const

/** A write of the page as an invoke: it resolves once done, or rejects with its failure. */
const write = <I, T>(run: (input: I) => ResultAsync<T, BusError>) =>
  fromPromise<T, I>(({ input }) => settled(run(input)))

/** The event that entered the state, as the input of its invoke. */
const taken =
  <E extends OrganisationEvent['type']>(type: E) =>
  ({ event }: { readonly event: OrganisationEvent }) => {
    assertEvent(event, type)

    return event
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

        const of = deps.current()
        const kept = context.errors.of === of ? context.errors.codes : {}

        enqueue.assign({
          errors: { of, codes: { ...kept, [part]: failureOf(event, UNKNOWN_FAILURE) } },
        })
      }),
      forget: assign(({ context }, params: { readonly part: ErrorPart }) => ({
        errors: { ...context.errors, codes: { ...context.errors.codes, [params.part]: undefined } },
      })),
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
          'create-form': {
            initial: 'closed',
            states: {
              closed: {
                on: {
                  'organisation.create.toggle-button': { target: 'open' },
                  'organisation.create.submit-button': { target: 'submitting' },
                },
              },
              open: {
                on: {
                  'organisation.create.toggle-button': { target: 'closed' },
                  'organisation.create.submit-button': { target: 'submitting' },
                },
              },
              submitting: {
                invoke: {
                  src: 'platform.organisations.create',
                  input: taken('organisation.create.submit-button'),
                  onDone: { target: '#organisation.viewing' },
                  onError: { target: 'open', actions: [CREATE_REFUSED] },
                },
              },
            },
          },
          'note-items': {
            initial: 'idle',
            states: {
              idle: {
                on: {
                  'organisation.notes.edit-button': { target: 'editing', actions: 'open' },
                  'organisation.notes.delete-button': { target: 'deleting' },
                },
              },
              editing: {
                on: {
                  'organisation.notes.save-button': { target: 'saving' },
                  'organisation.notes.edit-button': { target: 'editing', actions: 'open' },
                  'organisation.notes.delete-button': { target: 'deleting' },
                },
              },
              saving: {
                invoke: {
                  src: 'note.updateNote',
                  input: taken('organisation.notes.save-button'),
                  onDone: { target: 'idle', actions: [forget('notes')] },
                  onError: { target: 'editing', actions: [NOTE_REFUSED] },
                },
              },
              deleting: {
                invoke: {
                  src: 'note.deleteNote',
                  input: taken('organisation.notes.delete-button'),
                  onDone: { target: 'idle', actions: [forget('notes')] },
                  onError: { target: 'idle', actions: [DELETE_REFUSED] },
                },
              },
            },
          },
          invite: {
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
          },
          members: {
            initial: 'idle',
            states: {
              idle: { on: { 'organisation.members.remove-button': { target: 'running' } } },
              running: {
                invoke: {
                  src: 'platform.organisations.remove',
                  input: taken('organisation.members.remove-button'),
                  onDone: { target: 'idle', actions: [forget('members'), 'reread'] },
                  onError: { target: 'idle', actions: [REMOVE_REFUSED] },
                },
              },
            },
          },
          'notes-add': {
            initial: 'idle',
            states: {
              idle: { on: { 'organisation.notes.add-button': { target: 'running' } } },
              running: {
                invoke: {
                  src: 'note.createNote',
                  input: taken('organisation.notes.add-button'),
                  onDone: { target: 'idle', actions: [forget('notes')] },
                  onError: { target: 'idle', actions: [NOTE_REFUSED] },
                },
              },
            },
          },
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
