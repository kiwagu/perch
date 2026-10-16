/**
 * A composition root for seeding a SurrealDB stand from Bun or Node: the
 * application's own root and its user module over a remote engine, connected as a
 * system user. Seeded accounts and profiles therefore take the product path: the
 * account through the access method's sign-up, the profile through the command
 * bus, the Loro write path and the projector. Never part of the browser bundle.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import {
  type AuthUser,
  type DataError,
  LOCAL_DB,
  type LocalDb,
  SHAPE_RUNNER,
  type ShapeRunnerPort,
} from '@workspace/data'
import { remoteEngines } from '@workspace/data/engines/remote'
import { readSchema } from '@workspace/data/schema-files'
import type { Locale } from '@workspace/i18n'
import { type ProfileId, profileIdFactory } from '@workspace/ids'

import { PROFILE_SERVICE } from '../features/user/application/profile.service'
import { SIGN_IN_SERVICE } from '../features/user/application/sign-in.service'
import { UserModule } from '../features/user/user.module'

import type { CommandLogger } from './commands'
import { createAppRoot } from './root'
import { memoryStorage } from './storage'

export { checkProfileName } from '../features/user/domain/profile.entity'

export interface StandOptions {
  /** The stand's address; `http(s)://` is turned into the WebSocket endpoint sessions need. */
  readonly url: string
  readonly namespace: string
  readonly database: string
  readonly credentials: { readonly username: string; readonly password: string }
  readonly logger?: CommandLogger
}

export interface AccountInput {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly locale: Locale
}

export interface SeededAccount {
  readonly user: AuthUser
  readonly profileId: ProfileId
}

export type SeedError = DataError | BusError

export interface Stand {
  readonly local: LocalDb
  readonly runner: ShapeRunnerPort
  /** Creates the account and its profile, or signs in when the account exists; ends signed out. */
  ensureAccount(input: AccountInput): ResultAsync<SeededAccount, SeedError>
  close(): Promise<void>
}

const silent: CommandLogger = { info: () => {}, warn: () => {} }

function rpcUrl(url: string): string {
  const parsed = new URL(url)
  const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:'

  parsed.protocol = secure ? 'wss:' : 'ws:'
  parsed.pathname = '/rpc'

  return parsed.toString()
}

export function openStand(options: StandOptions): ResultAsync<Stand, DataError> {
  // The projector reports asynchronously; a seed fails on the first such report.
  const failures: DataError[] = []

  return createAppRoot({
    engines: remoteEngines(),
    url: rpcUrl(options.url),
    namespace: options.namespace,
    database: options.database,
    credentials: options.credentials,
    schema: readSchema(),
    storage: memoryStorage(),
    logger: options.logger ?? silent,
    onError: (error) => failures.push(error),
  }).map((services): Stand => {
    const scope = services.container.child()

    for (const provider of UserModule.providers) {
      scope.singleton(provider.provide, provider.useFactory)
    }

    const signIn = scope.get(SIGN_IN_SERVICE)
    const profiles = scope.get(PROFILE_SERVICE)
    const { session } = services

    const settled = (): ResultAsync<void, SeedError> =>
      ResultAsync.fromSafePromise(session.flush()).andThen(() => {
        const [failure] = failures.splice(0)

        return failure ? errAsync(failure) : okAsync(undefined)
      })

    const profileOf = (user: AuthUser, input: AccountInput) =>
      settled()
        .andThen(() => profiles.read({ user: user.id }))
        .andThen((rows): ResultAsync<{ id: ProfileId; locale: string | undefined }, SeedError> => {
          const [row] = rows

          if (row) {
            return okAsync({ id: row.id, locale: row.locale })
          }

          const id = profileIdFactory.create()

          return profiles
            .createProfile({ id, user: user.id, name: input.name, email: input.email })
            .map(() => ({ id, locale: undefined }))
        })

    return {
      local: services.container.get(LOCAL_DB),
      runner: services.container.get(SHAPE_RUNNER),
      ensureAccount: (input) =>
        signIn
          .signUp(input)
          .orElse((error) =>
            error.code === 'data:SIGN_UP_REJECTED' ? session.signIn(input) : errAsync(error),
          )
          .andThen((user) =>
            profileOf(user, input)
              .andThen((profile) =>
                profile.locale === input.locale
                  ? okAsync(profile.id)
                  : profiles
                      .updateLocale({ id: profile.id, locale: input.locale })
                      .map(() => profile.id),
              )
              .andThen((profileId) => settled().map(() => ({ user, profileId }))),
          )
          .andThen((seeded) => session.signOut().map(() => seeded)),
      close: () => services.close(),
    }
  })
}
