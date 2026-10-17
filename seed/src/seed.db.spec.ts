import { afterAll, describe, expect, it } from 'vitest'

import { inviteInto, readOrganisation, signInAndRead } from './__fixtures__/device'
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

// An account that is no seed account of the demo, and the organisation it creates: swept at the end.
const run = Date.now().toString(36)
const outsider = {
  run,
  email: `outsider.${run}@example.test`,
  password: 'outsider-seed-password',
  name: 'Outsider Example',
  bio: 'Creates an organisation that the seed does not.',
  locale: 'en',
} as const

afterAll(async () => {
  expect((await sweep(target, { emails })).isOk()).toBe(true)
  expect((await sweep(target, { emails: [outsider.email] })).isOk()).toBe(true)
})

describe('seeding through the gateway', () => {
  it('seeds the accounts through the gateway, and a second device sees them', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
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
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
    const manifest = (await runSeed({ ...target, mode }))._unsafeUnwrap()
    const acme = manifest.organisations['acme'] ?? expect.unreachable('the organisation acme')
    const [ann, beto] = ['ann', 'beto'].map((ref) => {
      const preset = catalog.accounts.find((account) => account.ref === ref)

      return accountFor(preset ?? expect.unreachable(`a preset ${ref}`), mode)
    })

    expect(acme.key).toBe('acme')
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
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
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

  it('sweeps seeded identities with their profiles, region rows, memberships and organisation databases', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (await runSeed({ ...target, mode: demo }))._unsafeUnwrap()
    const ann = catalog.accounts.find((preset) => preset.ref === 'ann')

    // An organisation of someone else that ann belongs to: only the sweep of ann's own memberships reaches it.
    expect(
      (
        await inviteInto(
          target.gatewayUrl,
          outsider,
          { key: `out_${outsider.run}`, name: 'Outside' },
          accountFor(ann ?? expect.unreachable('a preset ann'), demo).email,
        )
      ).isOk(),
    ).toBe(true)
    const before = await leftOnStand(target, manifest)

    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      tenants: 1,
      // Ann and beto in acme, and ann in the outsider's organisation.
      memberships: 3,
      databases: 1,
    })
    expect(before.regionRows).toBeGreaterThan(0)
    expect((await sweep(target, { emails }))._unsafeUnwrap()).toEqual({
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
