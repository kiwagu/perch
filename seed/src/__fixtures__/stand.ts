import type { Shape } from '@workspace/data'

import { openStand, openStandTenant, type SeedManifest, type StandOptions } from '../seed'

import membersText from './members.surql'
import standCountsText from './stand-counts.surql'

export interface LeftOnStand {
  readonly identities: number
  /** The organisations the accounts created. */
  readonly tenants: number
  /** The memberships of the accounts and the memberships in the manifest's organisations. */
  readonly memberships: number
  /** How many of the manifest's organisation databases `t_<key>` exist. */
  readonly databases: number
  readonly profiles: number
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
    'profile',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
    '_replica_peer',
  ],
}

const members: Shape<Record<string, never>, readonly string[]> = {
  id: 'fixture.members',
  kind: 'shape',
  text: membersText,
  params: [],
  tables: ['member'],
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

/** Reads, as the stand's operator, the identity keys of the member rows in the database of organisation `key`. */
export async function membersIn(target: StandOptions, key: string): Promise<readonly string[]> {
  const stand = (await openStandTenant(target, `t_${key}`))._unsafeUnwrap()

  try {
    return (await stand.runner.read(members, {}))._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}
