/**
 * The settings rows of the organisations an account administers, ensured on this browser. In the
 * tab that leads the sync, each organisation where the account is admin and whose database is open
 * gets its one row (`ost_<key>`) once the engine says its region caught up with the gateway, so a
 * row the server holds is pulled before anything is created. The tabs take their turns under one
 * Web Lock per account and organisation; a turn imports what the other tabs appended, flushes,
 * reads, creates only what is still missing, and flushes again. The write goes to that
 * organisation whichever is current, and only while the same space, the same engine, the
 * membership as admin and the open database still hold when it is admitted. A start that failed
 * is tried again after `START_RETRY_MS`; a new engine, a change of the memberships and a new sign-in
 * look again. A failure is logged by its code alone.
 */

import { ResultAsync } from 'neverthrow'

import { type DataError, dataError, tenantRegionId } from '@workspace/data'
import { CONTRACT_ROLES } from '@workspace/kernel'
import type { Clock } from '@workspace/replica'
import type { LockManagerLike, SyncEngine } from '@workspace/replica/sync'

import {
  organisationSettingsCommands,
  organisationSettingsShape,
} from '../features/organisation/application/organisation-settings/organisation-settings.model.gen'
import { organisationSettingsIdOf } from '../features/organisation/application/organisation-settings/organisation-settings-id'
import type { CommandsPort } from '../platform/commands.port'
import { ensured } from '../platform/ensured'
import type { SessionPort } from '../platform/session.port'

import { FIRST_PULL_WAIT_MS, START_RETRY_MS } from './account-starts'
import type { CommandLogger } from './commands'
import type { IdentitySpace, SyncState } from './identity-space'
import { oneTabAtATime } from './tab-lock'

export { START_RETRY_MS }

/** The lock an organisation start holds exclusive, per account and organisation, across the tabs. */
export const ORGANISATION_START_LOCK = 'perch.session.organisation-start'

export interface OrganisationStartsDeps {
  readonly session: Pick<SessionPort, 'subscribe' | 'subscribeMemberships'>
  /** The signed-in identity's space: its engine while this tab leads, its memberships, its organisations. */
  readonly space: () =>
    | Pick<IdentitySpace, 'identity' | 'sync' | 'memberships' | 'tenant'>
    | undefined
  readonly clock: Clock
  readonly locks: LockManagerLike | undefined
  readonly logger: Pick<CommandLogger, 'warn'>
  /** Runs commands into the organisation `key`'s region, each admitted only while `admitted` holds. */
  readonly commandsFor: (key: string, admitted: () => boolean) => CommandsPort
}

export interface OrganisationStarts {
  /** This tab's sync changed: a tab that leads looks for organisations whose row is missing. */
  syncState(state: SyncState): void
}

type Space = NonNullable<ReturnType<OrganisationStartsDeps['space']>>

export function organisationStarts(deps: OrganisationStartsDeps): OrganisationStarts {
  /** The engine each organisation's start was taken up by; another engine takes it up afresh. */
  const watched = new Map<string, SyncEngine>()

  const isAdmin = (space: Space, key: string) =>
    space
      .memberships()
      .some((member) => member.tenant.key === key && member.role === CONTRACT_ROLES.admin)

  const ensure = (space: Space, key: string, still: () => boolean): Promise<boolean> =>
    oneTabAtATime<void, DataError>(
      deps.locks,
      `${ORGANISATION_START_LOCK}.${space.identity.id}.${key}`,
      {
        broken: () =>
          dataError('data:WRITE_FAILED', 'the organisation start could not be completed'),
        unlocked: (cause) =>
          dataError('data:WRITE_FAILED', 'could not take the organisation start lock', cause),
      },
      () => {
        const view = space.tenant(key)

        if (view === undefined || !still()) {
          return ResultAsync.fromSafePromise(Promise.resolve())
        }

        const id = organisationSettingsIdOf(key)
        const projected = () => view.catchUpLocal().andThen(() => view.flush())
        const read = () => view.runner.read(organisationSettingsShape, { id })
        const create = () =>
          deps
            .commandsFor(key, still)
            .execute(organisationSettingsCommands.createOrganisationSettings, { id })
            .mapErr((failure) => dataError('data:WRITE_FAILED', failure.message ?? failure.code))

        return projected()
          .andThen(() => ensured<DataError>(read, create, projected))
          .andThen(() => view.flush())
      },
    ).match(
      () => true,
      (failure) => {
        deps.logger.warn({ event: 'organisation-start', outcome: failure.code })

        return false
      },
    )

  const take = (space: Space, engine: SyncEngine, key: string): void => {
    watched.set(key, engine)

    const still = () => {
      const now = deps.space()

      return (
        now !== undefined &&
        now.identity.id === space.identity.id &&
        now.sync === engine &&
        now.tenant(key) !== undefined &&
        isAdmin(now, key)
      )
    }
    const forget = () => {
      if (watched.get(key) === engine) {
        watched.delete(key)
      }
    }
    const attempt = (): void => {
      void engine.caughtUp(tenantRegionId(key), FIRST_PULL_WAIT_MS).then(
        async () => {
          if (!still()) {
            forget()

            return
          }

          if (!(await ensure(space, key, still))) {
            if (still()) {
              deps.clock.schedule(START_RETRY_MS, attempt)
            } else {
              forget()
            }
          }
        },
        () => (still() ? attempt() : forget()),
      )
    }

    attempt()
  }

  const look = (): void => {
    const space = deps.space()
    const engine = space?.sync

    if (space === undefined || engine === undefined) {
      return
    }

    for (const member of space.memberships()) {
      const key = member.tenant.key

      if (
        member.role === CONTRACT_ROLES.admin &&
        space.tenant(key) !== undefined &&
        watched.get(key) !== engine
      ) {
        take(space, engine, key)
      }
    }
  }

  // The page lives as long as the session it follows, so it never stops listening.
  deps.session.subscribe((user) => {
    if (user !== undefined) {
      look()
    }
  })
  deps.session.subscribeMemberships(look)

  return {
    syncState: (state) => {
      if (state.leader) {
        look()
      }
    },
  }
}
