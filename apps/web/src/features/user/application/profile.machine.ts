import type { ResultAsync } from 'neverthrow'
import { assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'
import type { ProfileId } from '@workspace/ids'

/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
const PROFILE_ERROR = 'user.profile.error'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'profile:UNKNOWN'

export interface ProfileFields {
  readonly name: string
  readonly bio: string
}

/** What the page holds beside the machine: the profile as stored, and what was typed into it. */
export interface ProfileValues {
  readonly id: ProfileId | undefined
  readonly stored: ProfileFields
  readonly drafts: ProfileFields
}

export interface ProfileContext {
  /** The code of the last refused save, until a save succeeds. */
  readonly error: string | undefined
  /** The fields whose region is `edited`: they show what was typed, not the stored value. */
  readonly edited: { readonly [Field in keyof ProfileFields]: boolean }
}

/** The events of the screen's flow: the anchors acted on, and the stored fields that changed. */
export type ProfileEvent =
  | { readonly type: 'user.profile.name-input' }
  | { readonly type: 'user.profile.bio-textarea' }
  | { readonly type: 'model.profile.name' }
  | { readonly type: 'model.profile.bio' }
  | { readonly type: 'user.profile.save-button' }
  | { readonly type: 'user.profile.sign-out-button' }
  | { readonly type: 'user.profile.sign-out-dialog.confirm-button' }
  | { readonly type: 'user.profile.sign-out-dialog.cancel-button' }

/** The params of the flow's effects: an anchor shows one of the codes; the app moves to a path. */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

interface NavigateParams {
  readonly to: string
}

/** What the machine asks of its host: a code shown outside the form, a move to a path. */
export type ProfileEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

export type SignOutOutcome = 'signed-out' | 'needs-confirmation'

export interface ProfileMachineDeps {
  readonly profiles: {
    readonly updateName: (input: {
      readonly id: ProfileId
      readonly name: string
    }) => ResultAsync<void, BusError>
    readonly updateBio: (input: {
      readonly id: ProfileId
      readonly bio: string
    }) => ResultAsync<void, BusError>
  }
  readonly signOut: (options?: {
    readonly forgetUnsent: true
  }) => ResultAsync<SignOutOutcome, DataError>
  /** Read at each guard and each write: what the page holds now. */
  readonly values: () => ProfileValues
}

/** The code a refused write rejected with, read off the error event of its invoke. */
function failureOf(event: object): string {
  const error = 'error' in event ? event.error : undefined

  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : UNKNOWN_FAILURE
}

/** A write that resolves once done, or rejects with its failure. */
async function settled<T>(result: ResultAsync<T, BusError | DataError> | undefined): Promise<T> {
  if (result === undefined) {
    return Promise.reject({ code: UNKNOWN_FAILURE })
  }

  const outcome = await result

  return outcome.isOk() ? outcome.value : Promise.reject(outcome.error)
}

const SAVED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['profile-saved'] },
} as const
const REFUSED = {
  type: 'show',
  params: {
    anchor: PROFILE_ERROR,
    codes: ['name-required', 'name-too-long', 'bio-too-long', 'failed'],
  },
} as const
const ASKED = {
  type: 'show',
  params: { anchor: 'user.profile.sign-out-dialog', codes: ['unsent-changes'] },
} as const
const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const

/**
 * The profile page as the screen's flow says (`contract/screens/me.yaml`): the name and the
 * bio each follow the stored value or hold what was typed, Save writes what changed, and the
 * sign-out runs on its own, each area a region. A button is enabled while a state handles its
 * event (`snapshot.can`). Its `show` keeps the code of the form's own error for the view and
 * emits any other; its `navigate` emits the path, for the host to move to.
 */
export function createProfileMachine(deps: ProfileMachineDeps) {
  /** What a field's input shows: what was typed while it is edited, else the stored value. */
  const inputOf = (context: ProfileContext, field: keyof ProfileFields): string => {
    const { stored, drafts } = deps.values()

    return context.edited[field] ? drafts[field] : stored[field]
  }

  return setup({
    types: {
      context: {} as ProfileContext,
      events: {} as ProfileEvent,
      emitted: {} as ProfileEmitted,
    },
    actors: {
      'profile.updateName': fromPromise<void, { readonly name: string }>(({ input }) => {
        const { id } = deps.values()

        return settled(id === undefined ? undefined : deps.profiles.updateName({ id, ...input }))
      }),
      'profile.updateBio': fromPromise<void, { readonly bio: string }>(({ input }) => {
        const { id } = deps.values()

        return settled(id === undefined ? undefined : deps.profiles.updateBio({ id, ...input }))
      }),
      'platform.sign-out': fromPromise<SignOutOutcome, { readonly forgetUnsent?: true }>(
        ({ input }) =>
          settled(deps.signOut(input.forgetUnsent ? { forgetUnsent: true } : undefined)),
      ),
    },
    guards: {
      nameChanged: ({ context }) => inputOf(context, 'name') !== deps.values().stored.name,
      bioChanged: ({ context }) => inputOf(context, 'bio') !== deps.values().stored.bio,
      // Asked only while the field is edited: its input is the draft.
      nameIsStored: () => {
        const { stored, drafts } = deps.values()

        return drafts.name.trim() === stored.name
      },
      bioIsStored: () => {
        const { stored, drafts } = deps.values()

        return drafts.bio === stored.bio
      },
      holdsUnsentChanges: ({ event }) => 'output' in event && event.output === 'needs-confirmation',
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === PROFILE_ERROR) {
          enqueue.assign({ error: failureOf(event) })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
      clearError: assign({ error: undefined }),
      mark: assign(
        (
          { context },
          params: { readonly field: keyof ProfileFields; readonly edited: boolean },
        ) => ({
          edited: { ...context.edited, [params.field]: params.edited },
        }),
      ),
    },
  }).createMachine({
    id: 'profile',
    initial: 'editing',
    context: { error: undefined, edited: { name: false, bio: false } },
    states: {
      editing: {
        type: 'parallel',
        states: {
          name: {
            initial: 'following',
            states: {
              following: {
                entry: { type: 'mark', params: { field: 'name', edited: false } },
                on: { 'user.profile.name-input': { target: 'edited' } },
              },
              edited: {
                entry: { type: 'mark', params: { field: 'name', edited: true } },
                on: {
                  'user.profile.name-input': { target: 'following', guard: 'nameIsStored' },
                  'model.profile.name': { target: 'following', guard: 'nameIsStored' },
                },
              },
            },
          },
          bio: {
            initial: 'following',
            states: {
              following: {
                entry: { type: 'mark', params: { field: 'bio', edited: false } },
                on: { 'user.profile.bio-textarea': { target: 'edited' } },
              },
              edited: {
                entry: { type: 'mark', params: { field: 'bio', edited: true } },
                on: {
                  'user.profile.bio-textarea': { target: 'following', guard: 'bioIsStored' },
                  'model.profile.bio': { target: 'following', guard: 'bioIsStored' },
                },
              },
            },
          },
          save: {
            initial: 'idle',
            states: {
              idle: {
                on: {
                  'user.profile.save-button': [
                    { target: 'saving-name', guard: 'nameChanged' },
                    { target: 'saving-bio', guard: 'bioChanged' },
                    { actions: ['clearError', SAVED] },
                  ],
                },
              },
              'saving-name': {
                invoke: {
                  src: 'profile.updateName',
                  input: ({ context }) => ({ name: inputOf(context, 'name') }),
                  onDone: [
                    { target: 'saving-bio', guard: 'bioChanged' },
                    { target: 'idle', actions: ['clearError', SAVED] },
                  ],
                  onError: { target: 'idle', actions: [REFUSED] },
                },
              },
              'saving-bio': {
                invoke: {
                  src: 'profile.updateBio',
                  input: ({ context }) => ({ bio: inputOf(context, 'bio') }),
                  onDone: { target: 'idle', actions: ['clearError', SAVED] },
                  onError: { target: 'idle', actions: [REFUSED] },
                },
              },
            },
          },
          session: {
            initial: 'idle',
            states: {
              idle: {
                on: { 'user.profile.sign-out-button': { target: 'signing-out' } },
              },
              'signing-out': {
                invoke: {
                  src: 'platform.sign-out',
                  input: {},
                  onDone: [
                    { target: 'confirming', guard: 'holdsUnsentChanges', actions: [ASKED] },
                    { target: '#profile.signed-out', actions: [TO_SIGN_IN] },
                  ],
                  onError: { target: '#profile.signed-out', actions: [TO_SIGN_IN] },
                },
              },
              confirming: {
                on: {
                  'user.profile.sign-out-dialog.confirm-button': { target: 'signing-out-anyway' },
                  'user.profile.sign-out-dialog.cancel-button': { target: 'idle' },
                },
              },
              'signing-out-anyway': {
                invoke: {
                  src: 'platform.sign-out',
                  input: { forgetUnsent: true },
                  onDone: { target: '#profile.signed-out', actions: [TO_SIGN_IN] },
                  onError: { target: '#profile.signed-out', actions: [TO_SIGN_IN] },
                },
              },
            },
          },
        },
      },
      'signed-out': { type: 'final' },
    },
  })
}
