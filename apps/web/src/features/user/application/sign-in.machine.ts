import type { Result } from 'neverthrow'
import { assign, fromPromise, setup } from 'xstate'

import type { AuthUser } from '@workspace/data'

import type { SignInError, SignInForm, SignInMode, SignInService } from './sign-in.service'

export interface SignInContext {
  readonly mode: SignInMode
  /** The code of the last failure, cleared by the next attempt. */
  readonly error: string | undefined
}

export type SignInEvent =
  | { readonly type: 'SUBMIT'; readonly form: SignInForm }
  | { readonly type: 'TOGGLE_MODE' }

const otherMode = (mode: SignInMode): SignInMode => (mode === 'sign-in' ? 'sign-up' : 'sign-in')

/** The sign-in form: one attempt at a time, failures keep the form open with their reason. */
export function createSignInMachine(service: Pick<SignInService, 'submit'>) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
    },
    actors: {
      submit: fromPromise<
        Result<AuthUser, SignInError>,
        { readonly mode: SignInMode; readonly form: SignInForm }
      >(async ({ input }) => service.submit(input.mode, input.form)),
    },
    actions: {
      toggleMode: assign({ mode: ({ context }) => otherMode(context.mode), error: undefined }),
    },
  }).createMachine({
    id: 'sign-in',
    initial: 'idle',
    context: { mode: 'sign-in', error: undefined },
    states: {
      idle: {
        on: { SUBMIT: 'submitting', TOGGLE_MODE: { actions: 'toggleMode' } },
      },
      submitting: {
        entry: assign({ error: undefined }),
        invoke: {
          src: 'submit',
          input: ({ context, event }) => ({
            mode: context.mode,
            form: (event as Extract<SignInEvent, { readonly type: 'SUBMIT' }>).form,
          }),
          onDone: [
            { guard: ({ event }) => event.output.isOk(), target: 'done' },
            {
              target: 'failed',
              actions: assign({
                error: ({ event }) =>
                  event.output.isErr() ? event.output.error.code : 'sign-in:UNKNOWN',
              }),
            },
          ],
        },
      },
      failed: {
        on: { SUBMIT: 'submitting', TOGGLE_MODE: { target: 'idle', actions: 'toggleMode' } },
      },
      done: { type: 'final' },
    },
  })
}
