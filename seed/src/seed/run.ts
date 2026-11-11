import { errAsync, okAsync, ResultAsync } from 'neverthrow'

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
  type OrganisationPreset,
  organisationFor,
  type SeedAccount,
  type SeedMode,
  validateCatalog,
} from '../catalog'

import { closing } from './closing'
import { type CommandRunner, OPERATOR_CLI } from './command-runner'
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
  /** Runs the host's operator command, which appoints the catalog's operators on the stand. */
  readonly runCommand: CommandRunner
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

/** One run of the operator command for `email`: it fails the seed on an exit other than 0. */
function grantOperator(
  runCommand: CommandRunner,
  stand: StandOptions,
  email: string,
): ResultAsync<void, SeedError> {
  const argv = [
    'bun',
    OPERATOR_CLI,
    `--url=${stand.url}`,
    `--namespace=${stand.namespace}`,
    `--database=${stand.database}`,
    `--user=${stand.credentials.username}`,
    `--pass=${stand.credentials.password}`,
    'grant',
    email,
  ]

  // What fails the seed says the email and the exit code, never the arguments: one holds a password.
  return ResultAsync.fromPromise(runCommand(argv), (reason) =>
    dataError(
      'data:COMMAND_FAILED',
      `the operator command could not run for ${email}: ${reason instanceof Error ? reason.message : String(reason)}`,
    ),
  ).andThen((exit) =>
    exit === 0
      ? okAsync(undefined)
      : errAsync(
          dataError('data:COMMAND_FAILED', `the operator command exited with ${exit} for ${email}`),
        ),
  )
}

/**
 * Appoints the accounts the catalog marks operators, one after the other, once they exist: the
 * host's operator command grants each the role in the directory of `stand` (the directory's own
 * namespace, database and system user, not an organisation's). Granting again changes nothing, so
 * a second run leaves them operators. The first command to fail stops the seed.
 */
export function grantOperators(
  runCommand: CommandRunner,
  stand: StandOptions,
  presets: Catalog,
  mode: SeedMode,
): ResultAsync<void, SeedError> {
  return presets.accounts
    .filter((preset) => preset.operator === true)
    .map((preset) => accountFor(preset, mode).email)
    .reduce<ResultAsync<void, SeedError>>(
      (done, email) => done.andThen(() => grantOperator(runCommand, stand, email)),
      okAsync(undefined),
    )
}

/** A member and the invitation its invite answered. */
interface Invitation {
  readonly member: SeedAccount
  readonly invitation: string
}

/** The account of a preset ref, or why the catalog has none. */
function accountOf(
  presets: Catalog,
  ref: string,
  mode: SeedMode,
): ResultAsync<SeedAccount, SeedError> {
  const preset = presets.accounts.find((account) => account.ref === ref)

  return preset
    ? okAsync(accountFor(preset, mode))
    : errAsync(dataError('data:QUERY_FAILED', `no account ${ref}`))
}

/**
 * One organisation: its administrator signs in, creates it and invites each member, which answers
 * the invitation each member then signs in to accept by its id; a member that is one already (a
 * second run) answers none, and does not sign in.
 */
function seedOrganisation(
  client: SeedClient,
  presets: Catalog,
  mode: SeedMode,
  preset: OrganisationPreset,
): ResultAsync<SeededOrganisation, SeedError> {
  const organisation = organisationFor(preset, mode)

  return accountOf(presets, preset.admin, mode)
    .andThen((admin) => client.signIn(admin))
    .andThen(() => client.ensureOrganisation(organisation))
    .andThen((membership) =>
      preset.members
        .reduce<ResultAsync<readonly Invitation[], SeedError>>(
          (invited, ref) =>
            invited.andThen((invitations) =>
              accountOf(presets, ref, mode).andThen((member) =>
                client
                  .ensureInvited(organisation.key, member.email)
                  .map((answer) =>
                    answer.kind === 'invited'
                      ? [...invitations, { member, invitation: answer.invitation }]
                      : invitations,
                  ),
              ),
            ),
          okAsync([]),
        )
        .andThen((invitations) =>
          invitations.reduce<ResultAsync<void, SeedError>>(
            (joined, { member, invitation }) =>
              joined
                .andThen(() => client.signIn(member))
                .andThen(() => client.ensureJoined(invitation))
                .map(() => undefined),
            okAsync(undefined),
          ),
        )
        .map(() => ({
          id: membership.tenant.id,
          key: membership.tenant.key,
          name: membership.tenant.name,
        })),
    )
}

/**
 * Each organisation of the catalog, one after the other: its administrator creates it and invites
 * its members, who join by accepting (so every account exists first).
 */
export function seedOrganisations(
  client: SeedClient,
  presets: Catalog,
  mode: SeedMode,
): ResultAsync<Record<string, SeededOrganisation>, SeedError> {
  return presets.organisations.reduce<ResultAsync<Record<string, SeededOrganisation>, SeedError>>(
    (done, preset) =>
      done.andThen((organisations) =>
        seedOrganisation(client, presets, mode, preset).map((seeded) => ({
          ...organisations,
          [preset.ref]: seeded,
        })),
      ),
    okAsync({}),
  )
}

/**
 * Seeds the catalog's accounts through the gateway as a device would, one account at a time,
 * each new one verified through the mail `inbox` reads, then the operators of the platform among
 * them are appointed through `runCommand` (the host's operator command, on the stand's directory),
 * then its organisations, whose administrators invite the members, who join by accepting (so
 * every account exists first). With `reset`, the stand's seed data is swept first. A catalog the run would not hold (an organisation key the run's
 * suffix makes too long, among others) is refused before anything.
 */
export function runSeed(options: SeedOptions): ResultAsync<SeedManifest, SeedError> {
  const { mode, reset, gatewayUrl, fetcher, inbox, runCommand, ...stand } = options
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
          grantOperators(runCommand, stand, presets, mode)
            .andThen(() => seedOrganisations(client, presets, mode))
            .map((organisations) => ({ accounts, organisations })),
        ),
      ),
    )
}
