import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import {
  type BusError,
  createBus,
  type EventBus,
  type Handlers,
  type Message,
  type Middleware,
} from '@workspace/cqrs'
import type { Command, DataError, WritePathPort } from '@workspace/data'

import type { CommandsPort } from '../platform/commands.port'
import type { AppEvent, CommandDone, CommandFailed } from '../platform/events.port'
import type { SessionPort } from '../platform/session.port'

/** Where the bus reports each command and how it ended. */
export interface CommandLogger {
  info(fields: Readonly<Record<string, unknown>>): void
  warn(fields: Readonly<Record<string, unknown>>): void
}

export interface CommandBusOptions {
  readonly writePath: WritePathPort
  readonly session: Pick<SessionPort, 'current'>
  readonly deviceId: string
  readonly logger: CommandLogger
  /** Where the bus tells how each command's write ended, after it did. */
  readonly events: Pick<EventBus<AppEvent>, 'publish'>
}

type RunCommand = Message<
  'command.run',
  { readonly command: Command<unknown>; readonly params: unknown }
>

const toBusError = (error: DataError): BusError => ({ code: error.code, message: error.message })

/** Checks params against the schema the modeling stage generated for the command. */
const validateParams: Middleware = (message, _context, next) => {
  const { command, params } = (message as RunCommand).payload

  if (!command.schema) {
    return next(message)
  }

  return ResultAsync.fromSafePromise(
    Promise.resolve(command.schema['~standard'].validate(params)),
  ).andThen((outcome) =>
    outcome.issues
      ? errAsync({ code: 'bus:INVALID_PAYLOAD', issues: outcome.issues })
      : next({ ...message, payload: { command, params: outcome.value } }),
  )
}

const logOutcome =
  (logger: CommandLogger): Middleware =>
  (message, context, next) => {
    const fields = {
      command: (message as RunCommand).payload.command.id,
      actor: context.actorId,
      correlationId: context.correlationId,
    }

    return next(message)
      .andTee(() => logger.info({ ...fields, outcome: 'ok' }))
      .orTee((error) => logger.warn({ ...fields, outcome: error.code }))
  }

/**
 * Tells the bus how a command's write ended, after it did: a subscriber that fails is logged,
 * never the command's failure, which has committed.
 */
function announce(
  options: Pick<CommandBusOptions, 'events' | 'logger'>,
  event: CommandDone | CommandFailed,
): ResultAsync<void, never> {
  return options.events.publish([event]).orElse((failure) => {
    options.logger.warn({ event: event.name, outcome: failure.code, causes: failure.causes })

    return okAsync(undefined)
  })
}

/**
 * The command bus of the application: every declared command passes logging and
 * params validation, then runs on the write path as the signed-in user; its outcome is
 * published once the write path resolved (`<command id>.done` or `.failed`).
 */
export function createCommandBus(options: CommandBusOptions): CommandsPort {
  const handlers = {
    'command.run': ({ payload }, context) => {
      const id = payload.command.id
      const about = () => ({ actorId: context.actorId, occurredAt: new Date() })

      return options.writePath
        .run(payload.command, payload.params, {
          actorId: context.actorId,
          correlationId: context.correlationId,
        })
        .mapErr(toBusError)
        .andThen(() =>
          announce(options, {
            name: `${id}.done`,
            payload: { params: payload.params },
            ...about(),
          }),
        )
        .orElse((error) =>
          announce(options, {
            name: `${id}.failed`,
            payload: { params: payload.params, error },
            ...about(),
          }).andThen(() => errAsync(error)),
        )
    },
  } satisfies Handlers<RunCommand>
  const bus = createBus<RunCommand, typeof handlers>(handlers, [
    logOutcome(options.logger),
    validateParams,
  ])

  return {
    execute: (command, params) =>
      bus
        .execute(
          { type: 'command.run', payload: { command: command as Command<unknown>, params } },
          {
            actorId: options.session.current()?.id ?? 'anonymous',
            deviceId: options.deviceId,
            tenantId: null,
            correlationId: crypto.randomUUID(),
          },
        )
        .map(() => undefined),
  }
}
