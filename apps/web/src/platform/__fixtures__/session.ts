import { errAsync } from 'neverthrow'

import { EventBus } from '@workspace/cqrs'
import { dataError } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container } from '@workspace/di'
import type { PlatformRole } from '@workspace/kernel'

import {
  settingsCommands,
  settingsShape,
} from '../../features/user/application/settings/settings.model.gen'
import {
  SETTINGS_SERVICE,
  SettingsService,
} from '../../features/user/application/settings/settings.service'
import { type AppEvent, EVENTS } from '../events.port'
import { PLATFORM_EVENTS, type PlatformEvent } from '../platform-events.port'
import { SERVED_BUILD } from '../served-build.port'
import type { ServicesView } from '../services'
import { type PushRejection, SESSION, type SessionPort } from '../session.port'
import { SYNC_STATUS, type SyncStatus } from '../sync-status.port'

const NO_ROLES: ReadonlySet<PlatformRole> = new Set()

/** A session nobody is signed in to. */
export function fakeSession(): { readonly session: SessionPort } {
  const refused = () => errAsync(dataError('data:AUTH_FAILED', 'not in this test'))

  return {
    session: {
      signUp: refused,
      signIn: refused,
      verifyEmail: refused,
      resendVerification: refused,
      requestPasswordReset: refused,
      resetPassword: refused,
      changePassword: refused,
      changeEmail: refused,
      confirmEmail: refused,
      requestAccountDeletion: refused,
      deleteAccount: refused,
      signOut: refused,
      signingOutEverywhere: () => refused,
      current: () => undefined,
      subscribe: () => () => {},
      signingInHere: () => false,
      flush: refused,
      notice: () => undefined,
      clearNotice: () => {},
      leaveNotice: () => {},
      dropNotice: () => {},
      protocolRefused: () => false,
      memberships: () => [],
      subscribeMemberships: () => () => {},
      currentTenant: () => undefined,
      selectTenant: () => {},
      roles: () => NO_ROLES,
      onRoles: () => () => {},
    },
  }
}

/**
 * The services a component test provides: the container resolves `session` and the app's bus,
 * reads find no shapes until the test sets one on `runner`, and `reject` publishes a change the
 * gateway refused on that bus, as the session does, and `refuseProtocol` a protocol it no longer
 * takes; `serveNewer` tells the shell's watch that the server serves another build, `sync`
 * sets the state of the sync (none at first, as for a guest), and `platformEvent` tells the
 * screens an event of the platform, as another tab of the browser raises one.
 */
export function fakeServices(session: SessionPort): ServicesView & {
  readonly runner: FakeShapeRunner
  readonly reject: (rejection: PushRejection) => Promise<void>
  readonly refuseProtocol: () => Promise<void>
  readonly serveNewer: (served: string) => void
  readonly sync: (status: SyncStatus | undefined) => void
  readonly platformEvent: (event: PlatformEvent) => void
} {
  const runner = new FakeShapeRunner()
  const events = new EventBus<AppEvent>()
  const watching = new Set<(served: string) => void>()
  const syncListeners = new Set<() => void>()
  const platformListeners = new Set<(event: PlatformEvent) => void>()
  let syncNow: SyncStatus | undefined
  // The settings the frame reads; their commands are not in these tests.
  const commands = {
    execute: () => errAsync(dataError('data:WRITE_FAILED', 'not in this test')),
  }

  return {
    container: new Container()
      .singleton(SESSION, () => session)
      .singleton(EVENTS, () => events)
      .singleton(SYNC_STATUS, () => ({
        current: () => syncNow,
        subscribe: (listener) => {
          syncListeners.add(listener)

          return () => syncListeners.delete(listener)
        },
      }))
      .singleton(SERVED_BUILD, () => ({
        watch: (onNewer) => {
          watching.add(onNewer)

          return () => watching.delete(onNewer)
        },
      }))
      .singleton(PLATFORM_EVENTS, () => ({
        listen: (listener) => {
          platformListeners.add(listener)

          return () => platformListeners.delete(listener)
        },
      }))
      .singleton(
        SETTINGS_SERVICE,
        () =>
          new SettingsService(runner, commands, {
            shape: settingsShape,
            commands: settingsCommands,
          }),
      ),
    runner,
    reject: (rejection) => {
      const about = { payload: rejection, actorId: 'idn_test', occurredAt: new Date() }

      return events
        .publish([
          rejection.reloaded
            ? { name: 'sync.changes-reloaded', ...about }
            : { name: 'sync.change-rejected', ...about },
        ])
        .match(
          () => undefined,
          () => undefined,
        )
    },
    refuseProtocol: () =>
      events
        .publish([
          {
            name: 'sync.protocol-refused',
            payload: null,
            actorId: 'idn_test',
            occurredAt: new Date(),
          },
        ])
        .match(
          () => undefined,
          () => undefined,
        ),
    serveNewer: (served) => {
      for (const onNewer of watching) {
        onNewer(served)
      }
    },
    sync: (status) => {
      syncNow = status

      for (const listener of syncListeners) {
        listener()
      }
    },
    platformEvent: (event) => {
      for (const listener of platformListeners) {
        listener(event)
      }
    },
  }
}
