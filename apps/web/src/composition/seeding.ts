/**
 * Seeding a SurrealDB stand from Bun or Node with the application's own services, connected
 * to the stand as a system user. Seeded accounts take the product path inside the stand: the
 * account through the access method's sign-up, the profile through the user module's
 * services, the command bus, the Loro write path of the identity's region and the projector.
 * Never part of the browser bundle.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import {
  type AuthUser,
  createAuth,
  type DataError,
  type LocalDb,
  openLocalDb,
  SHAPE_RUNNER,
  ShapeRunner,
  type ShapeRunnerPort,
} from '@workspace/data'
import { remoteEngines, wsRpcUrl } from '@workspace/data/engines/remote'
import { readSchema } from '@workspace/data/schema-files'
import { replicaSchema } from '@workspace/database/replica-schema'
import { Container } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import { type ProfileId, profileIdFactory } from '@workspace/ids'
import { LoroWritePath, Projector, RegionDoc } from '@workspace/replica'

import { PROFILE_SERVICE, type ProfileService } from '../features/user/application/profile.service'
import { UserModule } from '../features/user/user.module'
import { COMMANDS } from '../platform/commands.port'

import { type CommandLogger, createCommandBus } from './commands'

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

export function openStand(options: StandOptions): ResultAsync<Stand, DataError> {
  return openLocalDb({
    engines: remoteEngines(),
    url: wsRpcUrl(options.url),
    namespace: options.namespace,
    database: options.database,
    credentials: options.credentials,
    schema: readSchema(),
  }).map((local): Stand => {
    const auth = createAuth(local, {
      access: 'identity',
      namespace: options.namespace,
      database: options.database,
    })
    const runner = new ShapeRunner(local)
    // The projector reports asynchronously; a seed fails on the first such report.
    const failures: DataError[] = []

    /** Runs `work` with the user module's profile service writing into the identity's region. */
    const inRegion = <T>(
      user: AuthUser,
      work: (
        profiles: ProfileService,
        settled: () => ResultAsync<void, SeedError>,
      ) => ResultAsync<T, SeedError>,
    ): ResultAsync<T, SeedError> =>
      RegionDoc.open(local, { kind: 'private', id: `identity:${user.id}` }).andThen((region) => {
        const projector = new Projector(region, local, replicaSchema, {
          onError: (error) => failures.push(error),
        })
        const stopProjecting = projector.start()
        const commands = createCommandBus({
          writePath: new LoroWritePath(region, replicaSchema),
          session: { current: () => user },
          deviceId: 'seed',
          logger: options.logger ?? silent,
        })
        const scope = new Container()
          .singleton(SHAPE_RUNNER, () => runner)
          .singleton(COMMANDS, () => commands)
          .child()

        for (const provider of UserModule.providers) {
          scope.singleton(provider.provide, provider.useFactory)
        }

        const settled = (): ResultAsync<void, SeedError> =>
          region
            .flush()
            .andThen(() => projector.flush())
            .andThen(() => {
              const [failure] = failures.splice(0)

              return failure ? errAsync(failure) : okAsync(undefined)
            })
        const run = async () => {
          const result = await work(scope.get(PROFILE_SERVICE), settled)

          stopProjecting()
          region.close()

          return result
        }

        return new ResultAsync(run())
      })

    const ensureProfile = (
      user: AuthUser,
      input: AccountInput,
    ): ResultAsync<ProfileId, SeedError> =>
      inRegion(user, (profiles, settled) =>
        profiles
          .read({ identity: user.id })
          .andThen(
            (rows): ResultAsync<{ id: ProfileId; locale: string | undefined }, SeedError> => {
              const [row] = rows

              if (row) {
                return okAsync({ id: row.id, locale: row.locale })
              }

              const id = profileIdFactory.create()

              return profiles
                .createProfile({ id, identity: user.id, name: input.name, email: input.email })
                .map(() => ({ id, locale: undefined }))
            },
          )
          .andThen((profile) =>
            profile.locale === input.locale
              ? okAsync(profile.id)
              : profiles
                  .updateLocale({ id: profile.id, locale: input.locale })
                  .map(() => profile.id),
          )
          .andThen((profileId) => settled().map(() => profileId)),
      )

    return {
      local,
      runner,
      ensureAccount: (input) =>
        auth
          .signUp(input)
          .orElse((error) =>
            error.code === 'data:SIGN_UP_REJECTED' ? auth.signIn(input) : errAsync(error),
          )
          .andThen((user) => ensureProfile(user, input).map((profileId) => ({ user, profileId })))
          .andThen((seeded) => auth.signOut().map(() => seeded)),
      close: async () => {
        await auth.close()
        await local.close()
      },
    }
  })
}
