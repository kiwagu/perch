/**
 * The starts of new accounts on this browser: the service a first verification starts an account
 * with, and what finishes one it left half-way. Each time an identity's space opens here (the start
 * of the page, a sign-in, a verification) the start kept for it is finished, unless it waits for
 * the device's first pull: a sign-in that answered `start` (the account has no settings or profile
 * at the gateway yet) keeps one, which the tab that leads the sync finishes once its engine has
 * settled, so it creates only what the pull left missing. The tabs take their turns under one Web
 * Lock, each leaving its writes durable and projected for the next. A sign-out forgets the kept
 * start with the device (`forgetDevice`), a session that merely closes keeps it. A failure is
 * logged by its code alone.
 */

import { err, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type ShapeRunnerPort } from '@workspace/data'
import type { Clock } from '@workspace/replica'
import type { LockManagerLike, SyncEngine } from '@workspace/replica/sync'

import {
  type AccountStartFrom,
  AccountStartService,
  type KeptStartPort,
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
import type { IdentitySpace, SyncState } from './identity-space'
import { type KeyValueStorage, keptAccountStart } from './storage'
import { oneTabAtATime } from './tab-lock'

/** The lock an account start holds exclusive, in whichever tab of the browser runs it. */
export const ACCOUNT_START_LOCK = 'perch.session.account-start'

/**
 * The turns of the account starts of this browser's tabs: one at a time under the lock, each
 * flushing this tab's documents first (what they pulled projected in the shared local store, which
 * the start reads), handing that flush to the start, and flushing what it wrote before it lets go,
 * however it ended; a flush that failed around a start that went through is the turn's failure.
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
            const outcome = await flush().andThen(() => run(flush))
            const flushed = await flush()

            // What it wrote may not reach the next tab: the start says so.
            return outcome.isOk() && flushed.isErr() ? err(flushed.error) : outcome
          })(),
        ),
    )
}

/**
 * How long a leading tab gives its engine to settle at a time; a tab still leading with the same
 * engine waits again.
 */
export const FIRST_PULL_WAIT_MS = 30_000

/** How long a leading tab waits before it tries again a start that failed after the pull. */
export const START_RETRY_MS = 5_000

export interface AccountStartsDeps {
  readonly session: Pick<SessionPort, 'subscribe' | 'flush'>
  /** The signed-in identity's space: its sync engine while this tab leads the sync. */
  readonly space: () => Pick<IdentitySpace, 'identity' | 'sync'> | undefined
  /** Times the waits of a start that waits for the pull. */
  readonly clock: Clock
  readonly runner: ShapeRunnerPort
  readonly commands: CommandsPort
  readonly settings: SettingsService
  readonly storage: KeyValueStorage
  readonly locks: LockManagerLike | undefined
  readonly logger: Pick<CommandLogger, 'warn'>
}

/** The starts of new accounts on this browser, and what the root tells them. */
export interface AccountStarts {
  readonly service: AccountStartService
  /**
   * A sign-in answered that the account has not started: its start is kept until this device has
   * pulled what the account has. A name the profile refuses keeps nothing, and is logged.
   */
  keepAfterPull(user: AuthUser, from: AccountStartFrom): void
  /** This tab's sync changed: a tab that leads finishes a start waiting for the pull, once pulled. */
  syncState(state: SyncState): void
}

export function accountStarts(deps: AccountStartsDeps): AccountStarts {
  const kept = keptAccountStart(deps.storage)
  const starts = new AccountStartService(
    new ProfileService(deps.runner, deps.commands, {
      shape: profileShape,
      commands: profileCommands,
    }),
    deps.settings,
    kept,
    accountStartTurns(deps.locks, () => deps.session.flush()),
  )
  const logged = (failure: { readonly code: string }) =>
    deps.logger.warn({ event: 'account-start', outcome: failure.code })
  const afterPull = afterFirstPull(deps, kept, (user) =>
    starts.resumeAfterPull(user).match(
      () => true,
      (failure) => {
        logged(failure)

        return false
      },
    ),
  )

  // The page lives as long as the session it follows, so it never stops listening. Nobody signed
  // in changes nothing here: a closing session keeps the start, a sign-out forgot it already.
  deps.session.subscribe((user) => {
    if (user !== undefined) {
      void starts.resume(user).match(() => undefined, logged)
      // The space is open now: a tab that led before it was finishes what waits for the pull.
      afterPull()
    }
  })

  return {
    service: starts,
    keepAfterPull: (user, from) => starts.keepAfterPull(user, from).mapErr(logged),
    syncState: (state) => {
      if (state.leader) {
        afterPull()
      }
    },
  }
}

/**
 * What finishes a start that waits for this device's first pull: in the tab that leads the sync,
 * once its engine has settled (`SyncEngine.settled`): the channel is up, every region of the space
 * has had its first answer on this connection, the private region's included (the subscription,
 * sent with the document's version, is answered with every update of the gateway the device
 * lacked), the outbox is empty and nothing waits for an answer. The start's turn then projects
 * what was pulled before it reads, so it creates only what is still missing. An engine that does
 * not settle in time is asked again while it is still the tab's, and a start that failed is tried
 * again after `START_RETRY_MS` on the same engine, while it is kept and the engine is the tab's; a
 * new engine (a new leader, a change of the regions) is watched on its own.
 */
function afterFirstPull(
  deps: Pick<AccountStartsDeps, 'space' | 'clock'>,
  kept: KeptStartPort,
  finish: (user: AuthUser) => Promise<boolean>,
): () => void {
  let watched: SyncEngine | undefined

  /** The start kept for `identity` that waits for the pull, if any. */
  const waiting = (identity: string) => {
    const start = kept.kept()

    return start?.identity === identity && start.afterPull
  }

  return () => {
    const space = deps.space()
    const engine = space?.sync

    if (
      space === undefined ||
      engine === undefined ||
      engine === watched ||
      !waiting(space.identity.id)
    ) {
      return
    }

    watched = engine

    const user = space.identity
    const current = () => deps.space()?.sync === engine
    const attempt = (): void => {
      void engine.settled(FIRST_PULL_WAIT_MS).then(
        async () => {
          if (!current() || (await finish(user))) {
            return
          }

          if (current() && waiting(user.id)) {
            deps.clock.schedule(START_RETRY_MS, attempt)
          }
        },
        () => (current() ? attempt() : undefined),
      )
    }

    attempt()
  }
}
