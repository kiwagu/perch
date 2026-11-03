/**
 * The platform's events that reach the screens, from the facts of this browser no account owns:
 * a key of the site storage that another tab set, each key one event. The storage's own rules
 * keep it from echoing: a tab never hears its own write, a write that changes nothing tells
 * nothing, and a value kept before the tab opened tells nothing either. A tab that hears a key
 * only reads it; the one key's writer is the tab where the fact happened.
 */

import type { PlatformEvent, PlatformEventsPort } from '../platform/platform-events.port'
import { THEME_KEY } from '../platform/theme'

import { type KeyValueStorage, PASSWORD_RESET_KEY } from './storage'

/** The event each key of the storage tells when another tab sets it. */
const EVENT_OF_KEY: ReadonlyMap<string, PlatformEvent> = new Map<string, PlatformEvent>([
  [PASSWORD_RESET_KEY, { type: 'platform.password-reset' }],
  [THEME_KEY, { type: 'platform.theme-set' }],
])

export function platformEvents(storage: KeyValueStorage): PlatformEventsPort {
  return {
    listen: (listener) =>
      storage.onChangeElsewhere((key) => {
        const event = key === undefined ? undefined : EVENT_OF_KEY.get(key)

        // A key removed elsewhere, or every key cleared, is no fact.
        if (event !== undefined && key !== undefined && storage.get(key) !== undefined) {
          listener(event)
        }
      }),
  }
}
