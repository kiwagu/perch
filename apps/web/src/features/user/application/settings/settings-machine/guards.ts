import { assertEvent } from 'xstate'

import { failureOf } from '../../../../../platform/actor-outcome'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import { newPasswordGuards } from '../../new-password-guards.policy'

import type { SettingsEvent, SettingsMachineDeps } from './events'

/** The passwords a password event carries as typed: the new one and the one typed again. */
function passwordsOf(event: SettingsEvent): Passwords {
  assertEvent(event, [
    'user.settings.password.new-password-input',
    'user.settings.password.password-confirmation-input',
    'user.settings.password.save-button',
  ])

  return { password: event.password, confirmation: event.confirmation }
}

/** The failure of a deletion request whose account is the only admin of an organisation with others. */
const LAST_ADMIN = 'data:LAST_ADMIN'

/**
 * The guards of the screen's flow, by the names of its `meta.guards`: whether the account's
 * settings are on the device, whether the account a store began for has left, whether a deletion
 * request failed as the only admin of an organisation with other members, and those of a new
 * password typed twice.
 */
export function settingsGuards(deps: Pick<SettingsMachineDeps, 'values'>) {
  return {
    settingsHeld: () => deps.values().held,
    accountLeft: () => {
      const { account, storingFor } = deps.values()

      return account !== storingFor
    },
    // The invoke's error event, which the machine's own events do not name.
    deletionBlocked: ({ event }: { readonly event: object }) => failureOf(event, '') === LAST_ADMIN,
    ...newPasswordGuards(passwordsOf),
  }
}
