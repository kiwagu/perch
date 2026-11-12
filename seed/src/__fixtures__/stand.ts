import { type Command, runCommand, type Shape } from '@workspace/data'
import { z } from '@workspace/zod'

import { openStand, openStandTenant, type SeedManifest, type StandOptions } from '../seed'

import identityRolesText from './identity-roles.surql'
import memberWriteText from './member-write.surql'
import membersText from './members.surql'
import standCountsText from './stand-counts.surql'

export interface LeftOnStand {
  readonly identities: number
  /** The organisations the accounts created. */
  readonly tenants: number
  /** The memberships of the accounts and the memberships in the manifest's organisations. */
  readonly memberships: number
  /**
   * The pending invitations to the manifest's organisations, whoever they are for, and to the
   * manifest's accounts' addresses, whatever organisation they are to.
   */
  readonly invitations: number
  /** How many of the manifest's organisation databases `t_<key>` exist. */
  readonly databases: number
  readonly profiles: number
  readonly settings: number
  readonly regionRows: number
  /** The sum of the regions' heads: how many batches the server accepted into them. */
  readonly accepted: number
}

interface StandCountsParams {
  readonly emails: readonly string[]
  readonly ids: readonly string[]
  readonly regions: readonly string[]
  readonly databases: readonly string[]
  readonly tenantIds: readonly string[]
}

const standCounts: Shape<StandCountsParams, LeftOnStand> = {
  id: 'fixture.standCounts',
  kind: 'shape',
  text: standCountsText,
  params: [
    { name: 'emails', type: 'array<string>' },
    { name: 'ids', type: 'array<string>' },
    { name: 'regions', type: 'array<string>' },
    { name: 'databases', type: 'array<string>' },
    { name: 'tenantIds', type: 'array<string>' },
  ],
  tables: [
    'identity',
    'tenant',
    'membership',
    'invitation',
    'profile',
    'settings',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
    '_replica_peer',
  ],
}

const identityRoles: Shape<{ readonly emails: readonly string[] }, unknown> = {
  id: 'fixture.identityRoles',
  kind: 'shape',
  text: identityRolesText,
  params: [{ name: 'emails', type: 'array<string>' }],
  tables: ['identity'],
}

const IdentityRoles = z.array(z.object({ email: z.string(), role: z.string().nullish() }))

const members: Shape<Record<string, never>, readonly string[]> = {
  id: 'fixture.members',
  kind: 'shape',
  text: membersText,
  params: [],
  tables: ['member'],
}

const memberWrite: Command<{ readonly identity: string }> = {
  id: 'fixture.memberWrite',
  kind: 'command',
  text: memberWriteText,
  params: [{ name: 'identity', type: 'string' }],
  tables: ['member'],
  region: 'server',
  ops: [],
}

/** Reads, as the stand's operator, what a seed run left there for the accounts of its manifest. */
export async function leftOnStand(
  target: StandOptions,
  manifest: SeedManifest,
): Promise<LeftOnStand> {
  const accounts = Object.values(manifest.accounts)
  const ids = accounts.map((account) => account.id)
  const stand = (await openStand(target))._unsafeUnwrap()

  try {
    return (
      await stand.runner.read(standCounts, {
        emails: accounts.map((account) => account.email),
        ids,
        regions: ids.map((id) => `identity:${id}`),
        tenantIds: Object.values(manifest.organisations).map((organisation) => organisation.id),
        databases: Object.values(manifest.organisations).map(
          (organisation) => `t_${organisation.key}`,
        ),
      })
    )._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}

/**
 * Reads, as the stand's operator, which of the accounts at `emails` hold the platform role
 * `operator`: their addresses, in alphabetical order.
 */
export async function operatorsAmong(
  target: StandOptions,
  emails: readonly string[],
): Promise<readonly string[]> {
  const stand = (await openStand(target))._unsafeUnwrap()

  try {
    const rows = IdentityRoles.parse(
      (await stand.runner.read(identityRoles, { emails }))._unsafeUnwrap(),
    )

    return rows
      .filter((row) => row.role === 'operator')
      .map((row) => row.email)
      .sort()
  } finally {
    await stand.close()
  }
}

/** Reads, as the stand's operator, the identity keys of the member rows in the database of organisation `key`. */
export async function membersIn(target: StandOptions, key: string): Promise<readonly string[]> {
  const stand = (await openStandTenant(target, `t_${key}`))._unsafeUnwrap()

  try {
    return (await stand.runner.read(members, {}))._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}

/**
 * Writes, as the stand's operator, a member row for the identity key `identity` into the database
 * of organisation `key`, whatever the directory holds: a row no membership stands behind.
 */
export async function writeMemberIn(
  target: StandOptions,
  key: string,
  identity: string,
): Promise<void> {
  const stand = (await openStandTenant(target, `t_${key}`))._unsafeUnwrap()

  try {
    const written = await runCommand(stand.local, memberWrite, { identity })

    written._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}
