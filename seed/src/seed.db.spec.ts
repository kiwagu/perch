import { afterAll, describe, expect, it } from 'vitest'

import { signInAndRead } from './__fixtures__/device'
import { leftOnStand } from './__fixtures__/stand'
import { accountFor, catalog, type SeedMode } from './catalog'
import { runSeed, type StandTarget, sweep } from './seed'

// The e2e stand: its gateway creates the accounts, and its SurrealDB, reached as root, is
// where the sweep runs. The spec sweeps only the demo accounts it seeds, so the suites that
// share the stand (the gateway's smoke test, the e2e specs) keep their own accounts.
const target: StandTarget = {
  gatewayUrl: process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:5191',
  url: process.env['SURREAL_URL'] ?? 'http://127.0.0.1:8010',
  namespace: 'app',
  database: 'directory',
  credentials: { username: 'root', password: 'root' },
}

const demo: SeedMode = { kind: 'demo' }

const emails = catalog.accounts.map((preset) => accountFor(preset, demo).email)

afterAll(async () => {
  expect((await sweep(target, { emails })).isOk()).toBe(true)
})

describe('seeding through the gateway', () => {
  it('seeds the demo accounts through the gateway, and a second device sees them', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (await runSeed({ ...target, mode: demo }))._unsafeUnwrap()

    expect(manifest.accounts['ann']?.email).toBe('ann@example.test')

    for (const preset of catalog.accounts) {
      const account = accountFor(preset, demo)
      const seen = (await signInAndRead(target.gatewayUrl, account))._unsafeUnwrap()
      const profile = seen.profile ?? expect.unreachable(`a profile for ${preset.ref}`)

      expect(manifest.accounts[preset.ref]).toEqual({
        id: seen.user.id,
        email: account.email,
        profileId: profile.id,
      })
      expect(profile).toMatchObject({
        name: preset.name,
        email: account.email,
        bio: preset.bio,
        locale: preset.locale,
      })
    }
  })

  it('runs twice without duplicating anything', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const first = (await runSeed({ ...target, mode: demo }))._unsafeUnwrap()
    const before = await leftOnStand(target, first)
    const second = (await runSeed({ ...target, mode: demo }))._unsafeUnwrap()

    expect(second).toEqual(first)
    expect(before).toMatchObject({ identities: 2, profiles: 2 })
    expect(before.accepted).toBeGreaterThan(0)
    // The second run signed in and found everything in place: the gateway accepted nothing new.
    expect(await leftOnStand(target, second)).toEqual(before)
  })

  it('sweeps seeded identities with their profiles and region rows', async () => {
    const manifest = (await runSeed({ ...target, mode: demo }))._unsafeUnwrap()
    const before = await leftOnStand(target, manifest)

    expect(before).toMatchObject({ identities: 2, profiles: 2 })
    expect(before.regionRows).toBeGreaterThan(0)
    expect((await sweep(target, { emails }))._unsafeUnwrap()).toEqual({ accounts: 2 })
    expect(await leftOnStand(target, manifest)).toEqual({
      identities: 0,
      profiles: 0,
      regionRows: 0,
      accepted: 0,
    })
  })
})
