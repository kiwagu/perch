/**
 * The starts of new accounts on this browser: the service a first verification starts an account
 * with, and what finishes one it left half-way. Each time an identity's space opens here (the start
 * of the page, a sign-in, a verification) the start kept for it is finished; when the browser signs
 * out, the kept start goes with the data it held. A failure is logged by its code alone.
 */

import type { ShapeRunnerPort } from '@workspace/data'

import { AccountStartService } from '../features/user/application/account-start.service'
import { ProfileService } from '../features/user/application/profile.service'
import type { SettingsService } from '../features/user/application/settings/settings.service'
import {
  profileCommands,
  profileShape,
} from '../features/user/presentation/pages/profile/profile.model.gen'
import type { CommandsPort } from '../platform/commands.port'
import type { SessionPort } from '../platform/session.port'

import type { CommandLogger } from './commands'
import { type KeyValueStorage, keptAccountStart } from './storage'

export interface AccountStartsDeps {
  readonly session: Pick<SessionPort, 'subscribe'>
  readonly runner: ShapeRunnerPort
  readonly commands: CommandsPort
  readonly settings: SettingsService
  readonly storage: KeyValueStorage
  readonly logger: Pick<CommandLogger, 'warn'>
}

export function accountStarts(deps: AccountStartsDeps): AccountStartService {
  const starts = new AccountStartService(
    new ProfileService(deps.runner, deps.commands, {
      shape: profileShape,
      commands: profileCommands,
    }),
    deps.settings,
    keptAccountStart(deps.storage),
  )

  // The page lives as long as the session it follows, so it never stops listening.
  deps.session.subscribe((user) => {
    if (user === undefined) {
      starts.forget()

      return
    }

    void starts.resume(user).match(
      () => undefined,
      (failure) => deps.logger.warn({ event: 'account-start', outcome: failure.code }),
    )
  })

  return starts
}
