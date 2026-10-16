import { afterAll, describe, expect, it } from 'vitest'

import type { Shape } from '@workspace/data'

import standCountsText from './__fixtures__/stand-counts.surql'
import { catalog } from './catalog'
import { openStand, runSeed, type StandTarget, sweep } from './seed'

// Each run seeds its own database on the e2e stand, so a developer's demo data
// and parallel runs never meet.
const target: StandTarget = {
  url: process.env['SURREAL_URL'] ?? 'http://127.0.0.1:8010',
  namespace: 'app',
  database: `seed_${Date.now()}`,
  credentials: { username: 'root', password: 'root' },
}

const standCounts: Shape<
  Record<string, never>,
  { accounts: number; profiles: number; regions: number }
> = {
  id: 'fixture.standCounts',
  kind: 'shape',
  text: standCountsText,
  params: [],
  tables: ['identity', 'profile', '_replica_update'],
}

const counts = async () => {
  const stand = (await openStand(target))._unsafeUnwrap()

  try {
    return (await stand.runner.read(standCounts, {}))._unsafeUnwrap()
  } finally {
    await stand.close()
  }
}

const accounts = catalog.accounts.length

afterAll(async () => {
  expect((await sweep(target)).isOk()).toBe(true)
})

describe('seeding a stand', () => {
  it('creates the demo accounts with their profiles, and the same ones on every run', async () => {
    const first = (await runSeed({ ...target, mode: { kind: 'demo' } }))._unsafeUnwrap()
    const second = (await runSeed({ ...target, mode: { kind: 'demo' } }))._unsafeUnwrap()

    expect(Object.keys(first.accounts).sort()).toEqual(catalog.accounts.map((a) => a.ref).sort())
    expect(second).toEqual(first)
    expect(await counts()).toEqual({ accounts, profiles: accounts, regions: accounts })
  })

  it('creates new accounts on every fresh run', async () => {
    const run = (await runSeed({ ...target, mode: { kind: 'fresh', run: 'f1' } }))._unsafeUnwrap()

    for (const preset of catalog.accounts) {
      expect(run.accounts[preset.ref]?.email).toContain('.f1@')
    }

    expect((await counts()).accounts).toBe(2 * accounts)
  })

  it('sweeps every test account with its profile and its region, and reseeds after a reset', async () => {
    expect((await sweep(target))._unsafeUnwrap()).toEqual({ accounts: 2 * accounts })
    expect(await counts()).toEqual({ accounts: 0, profiles: 0, regions: 0 })

    expect((await runSeed({ ...target, mode: { kind: 'demo' }, reset: true })).isOk()).toBe(true)
    expect(await counts()).toEqual({ accounts, profiles: accounts, regions: accounts })
  })
})
