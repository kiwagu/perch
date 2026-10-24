import { errAsync } from 'neverthrow'

import { dataError } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container } from '@workspace/di'

import {
  settingsCommands,
  settingsShape,
} from '../../features/user/application/settings/settings.model.gen'
import {
  SETTINGS_SERVICE,
  SettingsService,
} from '../../features/user/application/settings/settings.service'
import type { ServicesView } from '../services'
import { type PushRejection, SESSION, type SessionPort } from '../session.port'

/** A session nobody is signed in to, which keeps the rejection listeners for the test to call. */
export function fakeSession(): {
  readonly session: SessionPort
  readonly reject: (r: PushRejection) => void
} {
  const listeners = new Set<(rejection: PushRejection) => void>()
  const refused = () => errAsync(dataError('data:AUTH_FAILED', 'not in this test'))

  return {
    session: {
      signUp: refused,
      signIn: refused,
      signOut: refused,
      signingOutEverywhere: () => refused,
      current: () => undefined,
      subscribe: () => () => {},
      flush: refused,
      notice: () => undefined,
      clearNotice: () => {},
      memberships: () => [],
      subscribeMemberships: () => () => {},
      currentTenant: () => undefined,
      selectTenant: () => {},
      subscribeRejections: (listener) => {
        listeners.add(listener)

        return () => listeners.delete(listener)
      },
    },
    reject: (rejection) => {
      for (const listener of listeners) {
        listener(rejection)
      }
    },
  }
}

/** The services a component test provides: the container resolves `session`, reads find no shapes until the test sets one on `runner`. */
export function fakeServices(
  session: SessionPort,
): ServicesView & { readonly runner: FakeShapeRunner } {
  const runner = new FakeShapeRunner()
  // The settings the frame reads; their commands are not in these tests.
  const commands = {
    execute: () => errAsync(dataError('data:WRITE_FAILED', 'not in this test')),
  }

  return {
    container: new Container()
      .singleton(SESSION, () => session)
      .singleton(
        SETTINGS_SERVICE,
        () =>
          new SettingsService(runner, commands, {
            shape: settingsShape,
            commands: settingsCommands,
          }),
      ),
    runner,
  }
}
