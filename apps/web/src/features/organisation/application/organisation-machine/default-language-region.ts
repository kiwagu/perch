import { CLEAR_SETTINGS_ERROR, SETTINGS_REFUSED } from './effects'
import { taken } from './events'

/**
 * The region of the screen's flow for the organisation's default language, for an admin: the
 * select takes a choice once the organisation's settings are on this device (`defaultsHeld`), the
 * clear button removes the language; one change at a time, each applied at once with no toast, its
 * failure kept for the settings' error and cleared by the next change that is done.
 */
export const DEFAULT_LANGUAGE_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: {
        'organisation.settings.locale-select': { target: 'storing', guard: 'defaultsHeld' },
        'organisation.settings.clear-button': { target: 'clearing' },
      },
    },
    storing: {
      invoke: {
        src: 'organisation_settings.updateLocale',
        input: taken('organisation.settings.locale-select'),
        onDone: { target: 'idle', actions: [CLEAR_SETTINGS_ERROR] },
        onError: { target: 'idle', actions: [SETTINGS_REFUSED] },
      },
    },
    clearing: {
      invoke: {
        src: 'organisation_settings.clearLocale',
        onDone: { target: 'idle', actions: [CLEAR_SETTINGS_ERROR] },
        onError: { target: 'idle', actions: [SETTINGS_REFUSED] },
      },
    },
  },
} as const
