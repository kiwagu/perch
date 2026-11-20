import type { ResultAsync } from 'neverthrow'
import { assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'

import type { ProfileContext, ProfileFields } from './context'
import type { ProfileMachineDeps, SignOutOutcome } from './deps'
import { ASKED, BIO_REFUSED, NAME_REFUSED, PROFILE_ERROR, SAVED, TO_SIGN_IN } from './effects'
import type { NavigateParams, ProfileEmitted, ProfileEvent, ShowParams } from './events'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'profile:UNKNOWN'

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

/**
 * The profile page as the screen's flow says (`contract/domain/screens/me.yaml`): the name and the
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
                  onError: { target: 'idle', actions: [NAME_REFUSED] },
                },
              },
              'saving-bio': {
                invoke: {
                  src: 'profile.updateBio',
                  input: ({ context }) => ({ bio: inputOf(context, 'bio') }),
                  onDone: { target: 'idle', actions: ['clearError', SAVED] },
                  onError: { target: 'idle', actions: [BIO_REFUSED] },
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
                meta: { renders: ['user.profile.sign-out-dialog'] },
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
