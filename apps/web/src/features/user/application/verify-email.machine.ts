import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { EmailVerified } from '../../../platform/session.port'

import type { SignInError } from './sign-in.service'

/** The anchor of the page's error: the machine keeps the code it shows for the view. */
const VERIFY_ERROR = 'user.verify-email.error'

/** The anchor of the page's message: the machine keeps the code it shows for the view. */
const VERIFY_MESSAGE = 'user.verify-email.message'

/** The codes the message shows. */
const MESSAGES = ['verified-before', 'check-your-mail'] as const

type MessageCode = (typeof MESSAGES)[number]

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'verify-email:UNKNOWN'

export interface VerifyEmailContext {
  /** The code of the failure the error shows: of the exchange, or of the last resend. */
  readonly error: string | undefined
  /** The code the message shows: the link was verified before, or a new one is on its way. */
  readonly message: MessageCode | undefined
}

/** The events of the screen's flow: the user acts on these anchors. */
export type VerifyEmailEvent = {
  readonly type: 'user.verify-email.resend-button'
  readonly email: string
}

/** The params of the flow's effects: an anchor shows one of the codes or goes; the app moves to a path. */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

interface ClearParams {
  readonly anchor: string
}

interface NavigateParams {
  readonly to: string
}

/** What the machine asks of its host: a code shown or cleared outside the page, a move to a path. */
export type VerifyEmailEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

/** The page's link and what it asks of the platform: the exchange of its token, a new link. */
export interface VerifyEmailMachineDeps {
  /** The token of the address the page was opened at. */
  readonly token: string
  readonly verify: (token: string) => ResultAsync<EmailVerified, SignInError>
  readonly resend: (email: string) => ResultAsync<void, SignInError>
}

/** Whether the exchange that ended with `event` signed this device in. */
function signedIn(event: object): boolean {
  const output = 'output' in event ? event.output : undefined

  return (
    typeof output === 'object' && output !== null && 'kind' in output && output.kind === 'signed-in'
  )
}

/** The email the resend button sent, which the resend takes. */
function emailInput({ event }: { readonly event: VerifyEmailEvent }): { readonly email: string } {
  assertEvent(event, 'user.verify-email.resend-button')

  return { email: event.email }
}

/**
 * The verify page as the screen's flow says (`contract/domain/screens/verify-email.yaml`): it
 * starts by exchanging the token of its address; the first verification welcomes on the frame and
 * moves to the profile, a link verified before says so and ends, a refused one offers to send a new
 * link to an email typed, as often as it is asked. Its `show` and `clear` keep the codes of the
 * page's error and message for the view and emit any other; its `navigate` emits the path, for
 * the host to move to.
 */
export function createVerifyEmailMachine(deps: VerifyEmailMachineDeps) {
  return setup({
    types: {
      context: {} as VerifyEmailContext,
      events: {} as VerifyEmailEvent,
      emitted: {} as VerifyEmailEmitted,
    },
    guards: {
      signedIn: ({ event }) => signedIn(event),
    },
    actors: {
      'platform.verify-email': fromPromise<EmailVerified, { readonly token: string }>(({ input }) =>
        settled(deps.verify(input.token)),
      ),
      'platform.resend-verification': fromPromise<void, { readonly email: string }>(({ input }) =>
        settled(deps.resend(input.email)),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === VERIFY_ERROR) {
          enqueue.assign({ error: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === VERIFY_MESSAGE) {
          enqueue.assign({ message: MESSAGES.find((code) => params.codes.includes(code)) })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === VERIFY_ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === VERIFY_MESSAGE) {
          enqueue.assign({ message: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    },
  }).createMachine({
    id: 'user.verify-email',
    initial: 'verifying',
    context: { error: undefined, message: undefined },
    states: {
      verifying: {
        invoke: {
          src: 'platform.verify-email',
          input: () => ({ token: deps.token }),
          onDone: [
            {
              target: 'done',
              guard: 'signedIn',
              actions: [
                {
                  type: 'show',
                  params: { anchor: 'app-shell.notice-message', codes: ['welcome'] },
                },
                { type: 'navigate', params: { to: '/me' } },
              ],
            },
            {
              target: 'verified',
              actions: [
                { type: 'show', params: { anchor: VERIFY_MESSAGE, codes: ['verified-before'] } },
              ],
            },
          ],
          onError: {
            target: 'resend-offered',
            actions: [
              {
                type: 'show',
                params: {
                  anchor: VERIFY_ERROR,
                  codes: [
                    'link-invalid',
                    'link-expired',
                    'other-account',
                    'rate-limited',
                    'failed',
                  ],
                },
              },
            ],
          },
        },
      },
      verified: { type: 'final' },
      'resend-offered': {
        on: { 'user.verify-email.resend-button': { target: 'resending' } },
      },
      resending: {
        invoke: {
          src: 'platform.resend-verification',
          input: emailInput,
          onDone: {
            target: 'sent',
            actions: [
              { type: 'clear', params: { anchor: VERIFY_ERROR } },
              { type: 'show', params: { anchor: VERIFY_MESSAGE, codes: ['check-your-mail'] } },
            ],
          },
          onError: {
            target: 'resend-offered',
            actions: [
              { type: 'clear', params: { anchor: VERIFY_MESSAGE } },
              { type: 'show', params: { anchor: VERIFY_ERROR, codes: ['rate-limited', 'failed'] } },
            ],
          },
        },
      },
      sent: {
        on: { 'user.verify-email.resend-button': { target: 'resending' } },
      },
      done: { type: 'final' },
    },
  })
}
