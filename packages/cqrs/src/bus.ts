import { errAsync, type ResultAsync } from 'neverthrow'

import type { ExecutionContext } from './context'

export interface Message<Type extends string = string, Payload = unknown> {
  readonly type: Type
  readonly payload: Payload
}

export interface BusError {
  readonly code: string
  readonly message?: string
  readonly issues?: readonly unknown[]
  readonly causes?: readonly BusError[]
}

export type HandlerFor<M extends Message> = (
  message: M,
  context: ExecutionContext,
) => ResultAsync<unknown, BusError>

/** One handler per message type; a missing or extra type is a compile error. */
export type Handlers<M extends Message> = {
  readonly [Type in M['type']]: HandlerFor<Extract<M, { readonly type: Type }>>
}

export type Next = (message: Message) => ResultAsync<unknown, BusError>

/** A step around every handler call: validation, logging, authorization, units of work. */
export type Middleware = (
  message: Message,
  context: ExecutionContext,
  next: Next,
) => ResultAsync<unknown, BusError>

type HandlerResult<Handler> = Handler extends (
  ...args: never[]
) => ResultAsync<infer Value, unknown>
  ? Value
  : never

export interface Bus<M extends Message, H extends Handlers<M>> {
  execute<T extends M>(
    message: T,
    context: ExecutionContext,
  ): ResultAsync<HandlerResult<H[T['type']]>, BusError>
}

/** Builds a command or query bus from a typed handler record and a middleware pipeline. */
export function createBus<M extends Message, H extends Handlers<M>>(
  handlers: H,
  middleware: readonly Middleware[] = [],
): Bus<M, H> {
  const table = handlers as unknown as Readonly<Record<string, HandlerFor<Message> | undefined>>

  return {
    execute(message, context) {
      const dispatch: Next = (current) => {
        const handler = table[current.type]

        return handler
          ? handler(current, context)
          : errAsync({ code: 'bus:NO_HANDLER', message: `no handler for ${current.type}` })
      }
      const pipeline = middleware.reduceRight<Next>(
        (next, step) => (current) => step(current, context, next),
        dispatch,
      )

      return pipeline(message) as ResultAsync<HandlerResult<H[typeof message.type]>, BusError>
    },
  }
}
