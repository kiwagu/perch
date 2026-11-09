import { okAsync } from 'neverthrow'

import { EventBus } from '@workspace/cqrs'

import type { AppEvent } from '../platform/events.port'

import type { CommandLogger } from './commands'

/**
 * The bus of the app's facts, which only the root publishes: the names of the events it carries
 * are logged when `logEvents` is on (development builds).
 */
export function appEvents(options: {
  readonly logEvents?: boolean
  readonly logger: CommandLogger
}): EventBus<AppEvent> {
  const events = new EventBus<AppEvent>()

  if (options.logEvents === true) {
    events.onAny((event) => {
      options.logger.info({ event: event.name })

      return okAsync(undefined)
    })
  }

  return events
}
