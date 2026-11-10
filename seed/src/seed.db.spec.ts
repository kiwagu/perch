import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { Mailbox } from '@workspace/mailbox'
import type { ClientOptions, Fetcher } from '@workspace/web/seeding'
import { z } from '@workspace/zod'

import {
  ensureOrganisationAs,
  inviteAndJoin,
  inviteAs,
  inviteInto,
  readOrganisation,
  signInAndRead,
} from './__fixtures__/device'
import { simulatedFront } from './__fixtures__/simulated-front'
import { leftOnStand, membersIn, writeMemberIn } from './__fixtures__/stand'
import { accountFor, catalog, type SeedMode } from './catalog'
import { openStand, runSeed, type StandTarget, sweep } from './seed'

// The e2e stand: its gateway creates the accounts, its mailbox receives their verification
// mails, and its SurrealDB, reached as root, is where the sweep runs. The spec sweeps only the
// demo accounts it seeds, so the suites that share the stand (the gateway's smoke test, the e2e
// specs) keep their own accounts. `bun run test:db` runs the suite through `mcproc exec`, which
// sets the addresses and the origin of the stand's front from the manifest's vars.
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
    GATEWAY_PUBLIC_URL: z.url({
      protocol: /^https?$/,
      error:
        "must be the http(s):// origin of the e2e stand's front; run the suite with bun run test:db",
    }),
    MAILBOX_URL: z.url({
      protocol: /^https?$/,
      error:
        "must be the http(s):// address of the e2e stand's mailbox; run the suite with bun run test:db",
    }),
  })
  .parse(process.env)
const target: StandTarget = {
  gatewayUrl: stand.GATEWAY_URL,
  url: stand.SURREAL_URL,
  namespace: 'app',
  database: 'directory',
  credentials: { username: 'root', password: 'root' },
}

const demo: SeedMode = { kind: 'demo' }

/** The stand's mailbox, where the seed reads each new account's verification link. */
const mailbox = new Mailbox(stand.MAILBOX_URL)

const emails = catalog.accounts.map((preset) => accountFor(preset, demo).email)

// An account that is no seed account of the demo, and the organisation it creates: swept at the end.
const run = Date.now().toString(36)
const outsider = {
  run,
  email: `outsider.${run}@example.test`,
  password: 'Seed-outsider-password-1',
  name: 'Outsider Example',
  bio: 'Creates an organisation that the seed does not.',
  locale: 'en',
} as const

// An account that keeps the session token its first verification gave while the stand is opened
// as its operator.
const keyholder = {
  name: 'Keyholder Example',
  email: `keyholder.${run}@example.test`,
  password: 'Seed-keyholder-password-1',
  device: { id: `seed-keyholder-${run}`, label: 'Seed spec' },
} as const

/** What a first verification answers, as far as this spec reads it: the session token the device keeps. */
const verified = z.object({ token: z.string() })

/**
 * The running test's client of the stand's gateway: each test is a simulated client with a
 * client address of its own, so the gateway's limits per address count the tests apart, behind
 * the stand's front, whose origin it names.
 */
let client: ClientOptions & { readonly fetcher: Fetcher }

beforeEach(({ task }) => {
  client = {
    gatewayUrl: target.gatewayUrl,
    fetcher: simulatedFront(task.name, stand.GATEWAY_PUBLIC_URL),
    inbox: mailbox,
  }
})

afterAll(async () => {
  expect((await sweep(target, { emails })).isOk()).toBe(true)
  expect((await sweep(target, { emails: [outsider.email, keyholder.email] })).isOk()).toBe(true)
})

describe("the stand's operator", () => {
  it('leaves the sessions the gateway opened live when it opens the stand', async () => {
    const seen = await mailbox.count(keyholder.email)
    const signUp = await client.fetcher(`${target.gatewayUrl}/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: keyholder.name,
        email: keyholder.email,
        password: keyholder.password,
        locale: 'en',
      }),
    })

    // The status first, so a refusal (a limit's 429 among them) fails with its status, not a parse.
    expect(signUp.status).toBe(202)

    // The link of its verification mail signs this device in, the first time.
    const link = await mailbox.verificationToken(keyholder.email, seen)
    const answer = await client.fetcher(`${target.gatewayUrl}/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Perch-Device': keyholder.device.id,
        'X-Perch-Device-Label': keyholder.device.label,
      },
      body: JSON.stringify({ token: link }),
    })

    expect(answer.status).toBe(200)

    const { token } = verified.parse(await answer.json())
    const opened = (await openStand(target))._unsafeUnwrap()

    await opened.close()

    // The directory schema is applied as the gateway applies it, or not at all: the session lives.
    const organisations = await client.fetcher(`${target.gatewayUrl}/organisations`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Perch-Device': keyholder.device.id },
    })

    expect(organisations.status).toBe(200)
  })
})

describe('seeding through the gateway', () => {
  it('seeds the accounts through the gateway, and a second device sees them', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const mode = demo
    const manifest = (await runSeed({ ...target, mode, ...client }))._unsafeUnwrap()

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
    const manifest = (await runSeed({ ...target, mode, ...client }))._unsafeUnwrap()
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
    const first = (await runSeed({ ...target, mode, ...client }))._unsafeUnwrap()
    const before = await leftOnStand(target, first)
    const second = (await runSeed({ ...target, mode, ...client }))._unsafeUnwrap()

    expect(second).toEqual(first)
    expect(before).toMatchObject({
      identities: 2,
      profiles: 2,
      settings: 2,
      tenants: 1,
      memberships: 2,
      // Beto accepted his invitation: none is left pending.
      invitations: 0,
      databases: 1,
    })
    expect(before.accepted).toBeGreaterThan(0)
    // The second run signed in and found everything in place: the gateway accepted nothing new.
    expect(await leftOnStand(target, second)).toEqual(before)
  })

  it('finds an organisation of its key only as its administrator', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    expect((await runSeed({ ...target, mode: demo, ...client })).isOk()).toBe(true)
    const ann = catalog.accounts.find((preset) => preset.ref === 'ann')
    const account = accountFor(ann ?? expect.unreachable('a preset ann'), demo)
    const organisation = { key: `mbr_${outsider.run}`, name: 'Outside member' }

    expect((await inviteAndJoin(client, outsider, organisation, account)).isOk()).toBe(true)
    // Ann belongs to it as a member: the key is taken by someone else's organisation.
    expect(
      (await ensureOrganisationAs(client, account, organisation))._unsafeUnwrapErr(),
    ).toMatchObject({ code: 'data:WRITE_REJECTED', message: 'key-taken' })
  })

  it('sweeps seeded identities with their profiles, settings, region rows, memberships and organisation databases', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (await runSeed({ ...target, mode: demo, ...client }))._unsafeUnwrap()
    const ann = catalog.accounts.find((preset) => preset.ref === 'ann')
    const annId = manifest.accounts['ann']?.id ?? expect.unreachable('the account ann')
    const outside = `out_${outsider.run}`

    // An organisation of someone else that ann belongs to, as she accepted its invitation: only the
    // sweep of ann's own memberships reaches it.
    expect(
      (
        await inviteAndJoin(
          client,
          outsider,
          { key: outside, name: 'Outside' },
          accountFor(ann ?? expect.unreachable('a preset ann'), demo),
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
      // Both invitations were accepted.
      invitations: 0,
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
      invitations: 0,
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

  it('sweeps an organisation whose database holds a member row with no membership', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (await runSeed({ ...target, mode: demo, ...client }))._unsafeUnwrap()
    const ann = accountFor(
      catalog.accounts.find((preset) => preset.ref === 'ann') ?? expect.unreachable('a preset ann'),
      demo,
    )
    const organisation = { key: `orphan_${outsider.run}`, name: 'Orphan member' }
    // The key of an identity the directory has never held.
    const stray = `stray_${outsider.run}`

    expect((await ensureOrganisationAs(client, ann, organisation)).isOk()).toBe(true)

    const created = (await readOrganisation(client, organisation.key, ann))._unsafeUnwrap()
    const seeded = {
      ...manifest,
      organisations: {
        ...manifest.organisations,
        orphan: { id: created.membership.tenant.id, ...organisation },
      },
    }

    await writeMemberIn(target, organisation.key, stray)
    expect(await membersIn(target, organisation.key)).toHaveLength(2)
    expect(await membersIn(target, organisation.key)).toContain(stray)
    expect(await leftOnStand(target, seeded)).toMatchObject({
      identities: 2,
      // Acme and the organisation of the stray row.
      tenants: 2,
      // Ann and beto in acme, and ann in the other.
      memberships: 3,
      databases: 2,
    })
    expect((await sweep(target, { emails }))._unsafeUnwrap()).toEqual({
      accounts: 2,
      organisations: 2,
    })
    expect(await leftOnStand(target, seeded)).toEqual({
      identities: 0,
      tenants: 0,
      memberships: 0,
      invitations: 0,
      databases: 0,
      profiles: 0,
      settings: 0,
      regionRows: 0,
      accepted: 0,
    })
  })

  it('sweeps the pending invitations of the organisations it removes, to any address, and those to the accounts it removes', async () => {
    expect((await sweep(target, { emails })).isOk()).toBe(true)
    const manifest = (await runSeed({ ...target, mode: demo, ...client }))._unsafeUnwrap()
    const acme = manifest.organisations['acme'] ?? expect.unreachable('the organisation acme')
    const ann = accountFor(
      catalog.accounts.find((preset) => preset.ref === 'ann') ?? expect.unreachable('a preset ann'),
      demo,
    )
    const pending = { key: `pnd_${outsider.run}`, name: 'Pending' }

    // In an organisation the sweep removes, to an address no swept account has: only the sweep of
    // the organisation's invitations reaches it.
    expect(
      (await inviteAs(client, ann, acme.key, `nobody.${outsider.run}@example.test`)).isOk(),
    ).toBe(true)
    // To a swept account, from an organisation that stays: only the sweep of the account's address
    // reaches it. Ann never accepts.
    expect((await inviteInto(client, outsider, pending, ann.email)).isOk()).toBe(true)
    expect((await leftOnStand(target, manifest)).invitations).toBe(2)
    expect((await sweep(target, { emails }))._unsafeUnwrap()).toEqual({
      accounts: 2,
      organisations: 1,
    })
    expect((await leftOnStand(target, manifest)).invitations).toBe(0)
  })
})
