/**
 * The starts of new accounts on this browser: the service a first verification starts an account
 * with, and what finishes one it left half-way. Each time an identity's space opens here (the start
 * of the page, a sign-in, a verification) the start kept for it is finished. The tabs take their
 * turns under one Web Lock, each leaving its writes durable and projected for the next. A sign-out
 * forgets the kept start with the device (`forgetDevice`), a session that merely closes keeps it.
 * A failure is logged by its code alone.
 */

import { err, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type ShapeRunnerPort } from '@workspace/data'
import type { LockManagerLike } from '@workspace/replica/sync'

import {
  AccountStartService,
  type StartTurns,
} from '../features/user/application/account-start.service'
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
import { oneTabAtATime } from './tab-lock'

/** The lock an account start holds exclusive, in whichever tab of the browser runs it. */
export const ACCOUNT_START_LOCK = 'perch.session.account-start'

/**
 * The turns of the account starts of this browser's tabs: one at a time under the lock, each
 * flushing what it wrote (durable and projected in the shared local store) before it lets go,
 * however it ended; a flush that failed after a start that went through is the turn's failure.
 */
export function accountStartTurns(
  locks: LockManagerLike | undefined,
  flush: () => ResultAsync<void, DataError>,
): StartTurns {
  return (run) =>
    oneTabAtATime(
      locks,
      ACCOUNT_START_LOCK,
      {
        broken: () => dataError('data:WRITE_FAILED', 'the account start could not be completed'),
        unlocked: (cause) =>
          dataError('data:WRITE_FAILED', 'could not take the account start lock', cause),
      },
      () =>
        new ResultAsync(
          (async () => {
            const outcome = await run()
            const flushed = await flush()

            // What it wrote may not reach the next tab: the start says so.
            return outcome.isOk() && flushed.isErr() ? err(flushed.error) : outcome
          })(),
        ),
    )
}

export interface AccountStartsDeps {
  readonly session: Pick<SessionPort, 'subscribe' | 'flush'>
  readonly runner: ShapeRunnerPort
  readonly commands: CommandsPort
  readonly settings: SettingsService
  readonly storage: KeyValueStorage
  readonly locks: LockManagerLike | undefined
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
    accountStartTurns(deps.locks, () => deps.session.flush()),
  )

  // The page lives as long as the session it follows, so it never stops listening. Nobody signed
  // in changes nothing here: a closing session keeps the start, a sign-out forgot it already.
  deps.session.subscribe((user) => {
    if (user !== undefined) {
      void starts.resume(user).match(
        () => undefined,
        (failure) => deps.logger.warn({ event: 'account-start', outcome: failure.code }),
      )
    }
  })

  return starts
}
