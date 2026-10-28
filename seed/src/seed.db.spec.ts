import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { ClientOptions, Fetcher } from '@workspace/web/seeding'
import { z } from '@workspace/zod'

import {
  ensureOrganisationAs,
  inviteInto,
  readOrganisation,
  signInAndRead,
} from './__fixtures__/device'
import { simulatedFront } from './__fixtures__/simulated-front'
import { leftOnStand, membersIn } from './__fixtures__/stand'
import { accountFor, catalog, type SeedMode } from './catalog'
import { openStand, runSeed, type StandTarget, sweep } from './seed'

// The e2e stand: its gateway creates the accounts, and its SurrealDB, reached as root, is
// where the sweep runs. The spec sweeps only the demo accounts it seeds, so the suites that
// share the stand (the gateway's smoke test, the e2e specs) keep their own accounts.
// `bun run test:db` runs the suite through `mcproc exec`, which sets both addresses and the key
// the stand's gateway signs with from the manifest's vars.
const signingKeyRule =
  'must be the key the gateway-e2e gateway signs with; run the suite with bun run test:db'
const stand = z
  .object({
    GATEWAY_URL: z.url({
      protocol: /^https?$/,
      error:
        'must be the http(s):// address of the gateway-e2e gateway; run the suite with bun run test:db',
    }),
    SURREAL_URL: z.url({
      protocol: /^https?$/,
      error:
        'must be the http(s):// address of the surrealdb-e2e stand; run the suite with bun run test:db',
    }),
    GATEWAY_JWT_KEY: z.string({ error: signingKeyRule }).min(1, { error: signingKeyRule }),
  })
  .parse(process.env)
const target: StandTarget = {
  gatewayUrl: stand.GATEWAY_URL,
  url: stand.SURREAL_URL,
  namespace: 'app',
  database: 'directory',
  credentials: { username: 'root', password: 'root' },
  signingKey: stand.GATEWAY_JWT_KEY,
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

// An account that keeps the pair it signed up with while the stand is opened as its operator.
const keyholder = {
  email: `keyholder.${run}@example.test`,
  password: 'keyholder-seed-password',
  device: { id: `seed-keyholder-${run}`, label: 'Seed spec' },
} as const

/** What a sign-up answers, as far as this spec reads it. */
const signedUp = z.object({ tokens: z.object({ access: z.string() }) })

/**
 * The running test's client of the stand's gateway: each test is a simulated client with a
 * client address of its own, so the gateway's limits per address count the tests apart.
 */
let client: ClientOptions & { readonly fetcher: Fetcher }

beforeEach(({ task }) => {
  client = { gatewayUrl: target.gatewayUrl, fetcher: simulatedFront(task.name) }
})

afterAll(async () => {
  expect((await sweep(target, { emails })).isOk()).toBe(true)
  expect((await sweep(target, { emails: [outsider.email, keyholder.email] })).isOk()).toBe(true)
})

describe("the stand's operator", () => {
  it('leaves the access tokens the gateway issued valid when it opens the stand', async () => {
    const answer = await client.fetcher(`${target.gatewayUrl}/auth/sign-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keyholder),
    })

    // The status first, so a refusal (a limit's 429 among them) fails with its status, not a parse.
    expect(answer.status).toBe(200)

    const { access } = signedUp.parse(await answer.json()).tokens
    const opened = (await openStand(target))._unsafeUnwrap()

    await opened.close()

    // The directory schema is applied with the gateway's key, or not at all: the token still works.
    const organisations = await client.fetcher(`${target.gatewayUrl}/organisations`, {
      headers: { Authorization: `Bearer ${access}`, 'X-Perch-Device': keyholder.device.id },
    })

    expect(organisations.status).toBe(200)
  })
})

describe('seeding through the gateway', () => {
  it('seeds the accounts through the gateway, and a second device sees them', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
    const manifest = (await runSeed({ ...target, mode, fetcher: client.fetcher }))._unsafeUnwrap()

    for (const preset of catalog.accounts) {
      const account = accountFor(preset, mode)
      const seen = (await signInAndRead(client, account))._unsafeUnwrap()
      const profile = seen.profile ?? expect.unreachable(`a profile for ${preset.ref}`)

      expect(manifest.accounts[preset.ref]).toEqual({
        id: seen.user.id,
        email: account.email,
        profileId: profile.id,
      })
      expect(profile).toMatchObject({ name: preset.name, email: account.email, bio: preset.bio })
      expect(seen.settings).toMatchObject({ locale: preset.locale })
    }
  })

  it('seeds acme with its administrator and member, and a second device of the member sees it', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
    const manifest = (await runSeed({ ...target, mode, fetcher: client.fetcher }))._unsafeUnwrap()
    const acme = manifest.organisations['acme'] ?? expect.unreachable('the organisation acme')
    const [ann, beto] = ['ann', 'beto'].map((ref) => {
      const preset = catalog.accounts.find((account) => account.ref === ref)

      return accountFor(preset ?? expect.unreachable(`a preset ${ref}`), mode)
    })

    expect(acme.key).toBe('acme')
    expect(acme.name).toBe('Acme Corp')

    const seenByBeto = (
      await readOrganisation(client, acme.key, beto ?? expect.unreachable('beto'))
    )._unsafeUnwrap()

    expect(seenByBeto.membership).toEqual({
      tenant: { id: acme.id, key: acme.key, name: 'Acme Corp' },
      role: 'member',
    })
    expect(seenByBeto.notes).toEqual([])

    const seenByAnn = (
      await readOrganisation(client, acme.key, ann ?? expect.unreachable('ann'))
    )._unsafeUnwrap()

    expect(seenByAnn.membership.role).toBe('admin')
  })

  it('runs twice without duplicating anything', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
    const first = (await runSeed({ ...target, mode, fetcher: client.fetcher }))._unsafeUnwrap()
    const before = await leftOnStand(target, first)
    const second = (await runSeed({ ...target, mode, fetcher: client.fetcher }))._unsafeUnwrap()

    expect(second).toEqual(first)
    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      settings: 2,
      tenants: 1,
      memberships: 2,
      databases: 1,
    })
    expect(before.accepted).toBeGreaterThan(0)
    // The second run signed in and found everything in place: the gateway accepted nothing new.
    expect(await leftOnStand(target, second)).toEqual(before)
  })

  it('finds an organisation of its key only as its administrator', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    expect((await runSeed({ ...target, mode: demo, fetcher: client.fetcher })).isOk()).toBe(true)
    const ann = catalog.accounts.find((preset) => preset.ref === 'ann')
    const account = accountFor(ann ?? expect.unreachable('a preset ann'), demo)
    const organisation = { key: `mbr_${outsider.run}`, name: 'Outside member' }

    expect((await inviteInto(client, outsider, organisation, account.email)).isOk()).toBe(true)
    // Ann belongs to it as a member: the key is taken by someone else's organisation.
    expect(
      (await ensureOrganisationAs(client, account, organisation))._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_REJECTED', message: 'key-taken' })
  })

  it('sweeps seeded identities with their profiles, settings, region rows, memberships and organisation databases', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (
      await runSeed({ ...target, mode: demo, fetcher: client.fetcher })
    )._unsafeUnwrap()
    const ann = catalog.accounts.find((preset) => preset.ref === 'ann')
    const annId = manifest.accounts['ann']?.id ?? expect.unreachable('the account ann')
    const outside = `out_${outsider.run}`

    // An organisation of someone else that ann belongs to: only the sweep of ann's own memberships reaches it.
    expect(
      (
        await inviteInto(
          client,
          outsider,
          { key: outside, name: 'Outside' },
          accountFor(ann ?? expect.unreachable('a preset ann'), demo).email,
        )
      ).isOk(),
    ).toBe(true)
    expect(await membersIn(target, outside)).toHaveLength(2)
    expect(await membersIn(target, outside)).toContain(annId)
    const before = await leftOnStand(target, manifest)

    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      settings: 2,
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
      settings: 0,
      regionRows: 0,
      accepted: 0,
    })
    // The outsider's organisation keeps its own member row; ann's goes with her membership.
    expect(await membersIn(target, outside)).toHaveLength(1)
    expect(await membersIn(target, outside)).not.toContain(annId)
  })
})
