import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { dataError } from '@workspace/data'
import {
  type ClientOptions,
  openClient,
  type SeedClient,
  type SeedError,
  type StandOptions,
} from '@workspace/web/seeding'

import {
  accountFor,
  type Catalog,
  catalog,
  organisationFor,
  type SeedMode,
  validateCatalog,
} from '../catalog'

import { closing } from './closing'
import { sweep } from './sweep'

/** Where a seed goes: the gateway that creates the accounts, and the stand behind it for a reset. */
export interface StandTarget extends StandOptions {
  /** The gateway's address, such as `http://127.0.0.1:5181`. */
  readonly gatewayUrl: string
}

export interface SeedOptions extends StandTarget, Pick<ClientOptions, 'fetcher' | 'inbox'> {
  readonly mode: SeedMode
  /** Sweep the stand's seed data first. */
  readonly reset?: boolean
}

export interface SeededEntry {
  readonly id: string
  readonly email: string
  readonly profileId: string
}

export interface SeededOrganisation {
  readonly id: string
  readonly key: string
  readonly name: string
}

/** What a seed run created or found, by catalog ref. */
export interface SeedManifest {
  readonly accounts: Readonly<Record<string, SeededEntry>>
  readonly organisations: Readonly<Record<string, SeededOrganisation>>
}

function seedAccounts(
  client: SeedClient,
  presets: Catalog,
  mode: SeedMode,
): ResultAsync<Record<string, SeededEntry>, SeedError> {
  return presets.accounts.reduce<ResultAsync<Record<string, SeededEntry>, SeedError>>(
    (done, preset) =>
      done.andThen((accounts) => {
        const account = accountFor(preset, mode)

        return client.ensureAccount(account).map((seeded) => ({
          ...accounts,
          [preset.ref]: { id: seeded.user.id, email: account.email, profileId: seeded.profileId },
        }))
      }),
    okAsync({}),
  )
}

/** Each organisation of the catalog: its administrator signs in, creates it and invites its members. */
function seedOrganisations(
  client: SeedClient,
  presets: Catalog,
  mode: SeedMode,
): ResultAsync<Record<string, SeededOrganisation>, SeedError> {
  return presets.organisations.reduce<ResultAsync<Record<string, SeededOrganisation>, SeedError>>(
    (done, preset) =>
      done.andThen((organisations) => {
        const admin = presets.accounts.find((account) => account.ref === preset.admin)
        const organisation = organisationFor(preset, mode)

        if (!admin) {
          return errAsync(dataError('data:QUERY_FAILED', `no account ${preset.admin}`))
        }

        return client
          .signIn(accountFor(admin, mode))
          .andThen(() => client.ensureOrganisation(organisation))
          .andThen((membership) =>
            preset.members
              .reduce<ResultAsync<void, SeedError>>(
                (invited, ref) =>
                  invited.andThen(() => {
                    const member = presets.accounts.find((account) => account.ref === ref)

                    return member
                      ? client.ensureMember(organisation.key, accountFor(member, mode).email)
                      : errAsync(dataError('data:QUERY_FAILED', `no account ${ref}`))
                  }),
                okAsync(undefined),
              )
              .map(() => ({
                ...organisations,
                [preset.ref]: {
                  id: membership.tenant.id,
                  key: membership.tenant.key,
                  name: membership.tenant.name,
                },
              })),
          )
      }),
    okAsync({}),
  )
}

/**
 * Seeds the catalog's accounts through the gateway as a device would, one account at a time,
 * each new one verified through the mail `inbox` reads, then its organisations, whose
 * administrators invite the members (so every account exists first). With `reset`, the stand's
 * seed data is swept first. A catalog the run would not hold (an organisation key the run's
 * suffix makes too long, among others) is refused before anything.
 */
export function runSeed(options: SeedOptions): ResultAsync<SeedManifest, SeedError> {
  const { mode, reset, gatewayUrl, fetcher, inbox, ...stand } = options
  const checked = validateCatalog(catalog, mode)

  if (checked.isErr()) {
    return errAsync(
      dataError('data:QUERY_FAILED', `the seed catalog is refused: ${checked.error.join('; ')}`),
    )
  }

  const presets = checked.value

  return (reset ? sweep(stand).map(() => undefined) : okAsync(undefined))
    .andThen(() => openClient(fetcher ? { gatewayUrl, fetcher, inbox } : { gatewayUrl, inbox }))
    .andThen((client) =>
      closing(
        client,
        seedAccounts(client, presets, mode).andThen((accounts) =>
          seedOrganisations(client, presets, mode).map((organisations) => ({
            accounts,
            organisations,
          })),
        ),
      ),
    )
}
