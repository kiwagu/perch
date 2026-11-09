import type { ResultAsync } from 'neverthrow'
import { emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import type { TenantRole } from '@workspace/replica/protocol'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { ClearParams, NavigateParams, ShowParams } from '../../../platform/flow-effects'
import type { InvitationOnLink } from '../../../platform/invitations.port'

/** The anchors whose codes the machine keeps for the view. */
const ERROR = 'organisation.invitation.error'
const MESSAGE = 'organisation.invitation.message'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'organisation:UNKNOWN'

/** The codes the contract lists for the page's error. */
const ERROR_CODES = [
  'link-invalid',
  'link-expired',
  'rate-limited',
  'other-account',
  'invitation-gone',
  'already-member',
  'failed',
] as const

export type InvitationErrorCode = (typeof ERROR_CODES)[number]

const isErrorCode = (code: string | undefined): code is InvitationErrorCode =>
  ERROR_CODES.some((each) => each === code)

/** The failures of a link that opens nothing: unknown, used, replaced, revoked or too old. */
const LINK_UNUSABLE: readonly string[] = ['link-invalid', 'link-expired']

/** What the states that ask render: the organisation and the role, with the two buttons. */
const ASKED = [
  'organisation.invitation.heading',
  'organisation.invitation.role-badge',
  'organisation.invitation.accept-button',
  'organisation.invitation.decline-button',
]

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: ERROR, codes } }) as const

const TO_THE_ORGANISATION = { type: 'navigate', params: { to: '/org' } } as const
const toast = (code: 'invitation-accepted' | 'invitation-declined') =>
  ({ type: 'show', params: { anchor: 'app-shell.toast', codes: [code] } }) as const

/** A refusal of a press that leaves the buttons for another press, showing `codes`. */
const refusedWith = (...codes: readonly string[]) => ({
  target: 'asking',
  actions: [showError(...codes)],
})

/** The refusal of a press for an invitation that is gone: the link does not work any more. */
const GONE = {
  target: 'link-dead',
  guard: 'invitationGone',
  actions: [showError('invitation-gone')],
} as const

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** What the read answered, off the done event of its invoke. */
function linkOf(event: object): InvitationOnLink | undefined {
  const output = 'output' in event ? event.output : undefined
  const organisation = isRecord(output) ? output['organisation'] : undefined

  if (!isRecord(output) || !isRecord(organisation)) {
    return undefined
  }

  const { role, forYou } = output
  const name = organisation['name']

  return typeof name === 'string' &&
    (role === 'admin' || role === 'member') &&
    typeof forYou === 'boolean'
    ? { organisation: { name }, role, forYou }
    : undefined
}

export interface InvitationContext {
  /** The name of the organisation the invitation is to. */
  readonly organisation: string | undefined
  /** The role the account takes when it accepts. */
  readonly role: TenantRole | undefined
  /** The code of the error the page shows. */
  readonly error: InvitationErrorCode | undefined
  /** The code the message shows to a guest. */
  readonly message: 'sign-in-to-accept' | undefined
}

/** The events of the screen's flow: the presses of its two buttons. */
export type InvitationEvent =
  | { readonly type: 'organisation.invitation.accept-button' }
  | { readonly type: 'organisation.invitation.decline-button' }

/** What the machine asks of its host: a move, a toast, any code shown or cleared outside the page. */
export type InvitationEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

export interface InvitationMachineDeps {
  /** The token of the address the page was opened at. */
  readonly token: string
  /** What the link of the invitation shows, for the account signed in here or nobody. */
  readonly read: (token: string) => ResultAsync<InvitationOnLink, BusError>
  /** Accepts the invitation the token names: the account joins and its organisation is current. */
  readonly accept: (invitation: string) => ResultAsync<unknown, BusError>
  /** Declines the invitation the token names. */
  readonly decline: (invitation: string) => ResultAsync<void, BusError>
  /** The identity signed in on this device now, if any. */
  readonly current: () => string | undefined
}

/**
 * The page the link of an invitation mail opens, as its screen's flow says: it reads the token of
 * its address, then asks the account the invitation is for to accept or decline, tells nobody
 * signed in here to sign in to that account, and tells another account that the invitation is not
 * its own; a link that opens nothing ends on its error. Accepting and declining move to the
 * organisation page. The codes of the page's error are narrowed to those the flow lists for the
 * transition showing them. Its `show` and `clear` keep the codes of the page's error and message
 * for the view and emit any other; its `navigate` emits the path, for the host to move to.
 */
export function createInvitationMachine(deps: InvitationMachineDeps) {
  return setup({
    types: {
      context: {} as InvitationContext,
      events: {} as InvitationEvent,
      emitted: {} as InvitationEmitted,
    },
    guards: {
      forThisAccount: ({ event }) => linkOf(event)?.forYou === true,
      nobodyHere: () => deps.current() === undefined,
      linkUnusable: ({ event }) => LINK_UNUSABLE.includes(failureOf(event, UNKNOWN_FAILURE)),
      invitationGone: ({ event }) => failureOf(event, UNKNOWN_FAILURE) === 'invitation-gone',
    },
    actors: {
      'platform.invitations.read': fromPromise<InvitationOnLink, { readonly token: string }>(
        ({ input }) => settled(deps.read(input.token)),
      ),
      'platform.invitations.accept': fromPromise<unknown, { readonly token: string }>(({ input }) =>
        settled(deps.accept(input.token)),
      ),
      'platform.invitations.decline': fromPromise<void, { readonly token: string }>(({ input }) =>
        settled(deps.decline(input.token)),
      ),
    },
    actions: {
      // What the link shows, whoever it is for: the organisation's name and the role.
      shown: enqueueActions(({ enqueue, event }) => {
        const link = linkOf(event)

        enqueue.assign({ organisation: link?.organisation.name, role: link?.role })
      }),
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === ERROR) {
          // The code of a refusal; a transition that shows one code without a refusal shows it as it is.
          const code = 'error' in event ? failureOf(event, UNKNOWN_FAILURE) : params.codes[0]

          // A refusal the flow does not list for this transition is one of "any other reason".
          enqueue.assign({
            error: isErrorCode(code) && params.codes.includes(code) ? code : 'failed',
          })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({
            message: params.codes.includes('sign-in-to-accept') ? 'sign-in-to-accept' : undefined,
          })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({ message: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    },
  }).createMachine({
    id: 'organisation.invitation',
    initial: 'checking',
    context: { organisation: undefined, role: undefined, error: undefined, message: undefined },
    states: {
      checking: {
        meta: { renders: ['organisation.invitation.status'] },
        invoke: {
          src: 'platform.invitations.read',
          input: () => ({ token: deps.token }),
          onDone: [
            { target: 'asking', guard: 'forThisAccount', actions: ['shown'] },
            {
              target: 'signing-in',
              guard: 'nobodyHere',
              actions: [
                'shown',
                { type: 'show', params: { anchor: MESSAGE, codes: ['sign-in-to-accept'] } },
              ],
            },
            { target: 'elsewhere', actions: ['shown', showError('other-account')] },
          ],
          onError: [
            { target: 'link-dead', guard: 'linkUnusable', actions: [showError(...LINK_UNUSABLE)] },
            { target: 'unread', actions: [showError('rate-limited', 'failed')] },
          ],
        },
      },
      asking: {
        meta: { renders: ASKED },
        on: {
          'organisation.invitation.accept-button': { target: 'accepting' },
          'organisation.invitation.decline-button': { target: 'declining' },
        },
      },
      accepting: {
        meta: { renders: ASKED },
        entry: [{ type: 'clear', params: { anchor: ERROR } }],
        invoke: {
          src: 'platform.invitations.accept',
          input: () => ({ token: deps.token }),
          onDone: {
            target: 'joined',
            actions: [TO_THE_ORGANISATION, toast('invitation-accepted')],
          },
          onError: [GONE, refusedWith('other-account', 'already-member', 'failed')],
        },
      },
      declining: {
        meta: { renders: ASKED },
        entry: [{ type: 'clear', params: { anchor: ERROR } }],
        invoke: {
          src: 'platform.invitations.decline',
          input: () => ({ token: deps.token }),
          onDone: {
            target: 'declined',
            actions: [TO_THE_ORGANISATION, toast('invitation-declined')],
          },
          onError: [GONE, refusedWith('other-account', 'failed')],
        },
      },
      'signing-in': {
        type: 'final',
        meta: {
          renders: [
            'organisation.invitation.heading',
            'organisation.invitation.role-badge',
            'organisation.invitation.message',
            'organisation.invitation.sign-in-link',
          ],
        },
      },
      elsewhere: {
        type: 'final',
        meta: {
          renders: ['organisation.invitation.heading', 'organisation.invitation.role-badge'],
        },
      },
      'link-dead': { type: 'final' },
      unread: { type: 'final' },
      joined: { type: 'final' },
      declined: { type: 'final' },
    },
  })
}
