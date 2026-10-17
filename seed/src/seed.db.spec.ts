import { afterAll, describe, expect, it } from 'vitest'

import { readOrganisation, signInAndRead } from './__fixtures__/device'
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

// Each case seeds a run of its own. The gateway keeps the connection to an organisation's
// database open for minutes after its last use, so an organisation swept and then created
// again under the same key within that time would meet a connection to the removed database.
const used: string[] = []

function runMode(name: string): SeedMode {
  const mode: SeedMode = { kind: 'fresh', run: `${name}${Date.now().toString(36)}` }

  used.push(...emailsOf(mode))

  return mode
}

function emailsOf(mode: SeedMode): string[] {
  return catalog.accounts.map((preset) => accountFor(preset, mode).email)
}

afterAll(async () => {
  expect((await sweep(target, { emails: used })).isOk()).toBe(true)
})

describe('seeding through the gateway', () => {
  it('seeds the accounts through the gateway, and a second device sees them', async () => {
    const mode = runMode('a')
    const manifest = (await runSeed({ ...target, mode }))._unsafeUnwrap()

    for (const preset of catalog.accounts) {
      const account = accountFor(preset, mode)
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

  it('seeds acme with its administrator and member, and a second device of the member sees it', async () => {
    const mode = runMode('b')
    const manifest = (await runSeed({ ...target, mode }))._unsafeUnwrap()
    const acme = manifest.organisations['acme'] ?? expect.unreachable('the organisation acme')
    const [ann, beto] = ['ann', 'beto'].map((ref) => {
      const preset = catalog.accounts.find((account) => account.ref === ref)

      return accountFor(preset ?? expect.unreachable(`a preset ${ref}`), mode)
    })

    expect(acme.key).toMatch(/^acme_/)
    expect(acme.name).toBe('Acme Corp')

    const seenByBeto = (
      await readOrganisation(target.gatewayUrl, acme.key, beto ?? expect.unreachable('beto'))
    )._unsafeUnwrap()

    expect(seenByBeto.membership).toEqual({
      tenant: { id: acme.id, key: acme.key, name: 'Acme Corp' },
      role: 'member',
    })
    expect(seenByBeto.notes).toEqual([])

    const seenByAnn = (
      await readOrganisation(target.gatewayUrl, acme.key, ann ?? expect.unreachable('ann'))
    )._unsafeUnwrap()

    expect(seenByAnn.membership.role).toBe('admin')
  })

  it('runs twice without duplicating anything', async () => {
    const mode = runMode('c')
    const first = (await runSeed({ ...target, mode }))._unsafeUnwrap()
    const before = await leftOnStand(target, first)
    const second = (await runSeed({ ...target, mode }))._unsafeUnwrap()

    expect(second).toEqual(first)
    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      tenants: 1,
      memberships: 2,
      databases: 1,
    })
    expect(before.accepted).toBeGreaterThan(0)
    // The second run signed in and found everything in place: the gateway accepted nothing new.
    expect(await leftOnStand(target, second)).toEqual(before)
  })

  it('sweeps seeded identities with their profiles, region rows and organisation databases', async () => {
    const mode = runMode('d')
    const manifest = (await runSeed({ ...target, mode }))._unsafeUnwrap()
    const before = await leftOnStand(target, manifest)

    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      tenants: 1,
      memberships: 2,
      databases: 1,
    })
    expect(before.regionRows).toBeGreaterThan(0)
    expect((await sweep(target, { emails: emailsOf(mode) }))._unsafeUnwrap()).toEqual({
      accounts: 2,
      organisations: 1,
    })
    expect(await leftOnStand(target, manifest)).toEqual({
      identities: 0,
      tenants: 0,
      memberships: 0,
      databases: 0,
      profiles: 0,
      regionRows: 0,
      accepted: 0,
    })
  })
})
