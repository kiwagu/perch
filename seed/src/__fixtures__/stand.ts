import type { Shape } from '@workspace/data'

import { openStand, type SeedManifest, type StandOptions } from '../seed'

import standCountsText from './stand-counts.surql'

export interface LeftOnStand {
  readonly identities: number
  readonly profiles: number
  readonly regionRows: number
  /** The sum of the regions' heads: how many batches the server accepted into them. */
  readonly accepted: number
}

interface StandCountsParams {
  readonly emails: readonly string[]
  readonly ids: readonly string[]
  readonly regions: readonly string[]
}

const standCounts: Shape<StandCountsParams, LeftOnStand> = {
  id: 'fixture.standCounts',
  kind: 'shape',
  text: standCountsText,
  params: [
    { name: 'emails', type: 'array<string>' },
    { name: 'ids', type: 'array<string>' },
    { name: 'regions', type: 'array<string>' },
  ],
  tables: [
    'identity',
    'profile',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
  ],
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
      })
    )._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}
