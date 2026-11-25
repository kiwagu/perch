import { afterEach, describe, expect, it, vi } from 'vitest'

import { CONTRACT_ROLES } from '@workspace/kernel'

import { ADDRESS_INVITES, ADDRESS_MAILS, IDENTITY_INVITES } from '../../limits/windows'
import { ADDRESS, closeHarness, harness, request } from '../__fixtures__/organisation-routes'

afterEach(closeHarness)

describe('organisationRoutes', () => {
  describe('limits', () => {
    const minute = 60_000
    /** The invitations an admin makes within the window (`IDENTITY_INVITES`). */
    const INVITES = IDENTITY_INVITES.limit
    /** An address no request of a test came from but the one that names it. */
    const OTHER = '203.0.113.77'
    /**
     * The `n`-th of the addresses a test spreads an admin's invitations over, one each, so no
     * address's mails or invitations run out before the admin's own window does.
     */
    const apart = (n: number) => `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`

    /** The path an admin invites on. */
    const invitationsOf = (key: string) => `/organisations/${key}/invitations`

    /** The body inviting the n-th email nobody has an account for: accepted, and an attempt. */
    const stranger = (n: number) => ({
      email: `stranger-${n}@example.test`,
      role: CONTRACT_ROLES.member,
    })

    it("lets an admin's invites the contract allows within its window reach the service, unknown emails included, and answers the next 429 without calling it", async () => {
      const { root, ann, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()

      for (let n = 0; n < INVITES; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, from: apart(n), body: stranger(n) }))
            .status,
        ).toBe(201)
      }

      expect(invite).toHaveBeenCalledTimes(INVITES)

      // From an address with its mails and invitations untouched: only the admin's limit refuses it.
      const refused = await ask('POST', invitationsOf('acme'), {
        as: ann,
        from: OTHER,
        body: stranger(INVITES),
      })

      expect(refused).toEqual({ status: 429, body: { code: 'rate-limited' } })
      expect(invite).toHaveBeenCalledTimes(INVITES)
    })

    it('answers 429 with Retry-After in whole seconds', async () => {
      const { routes, floor, ann, founded } = await harness()

      await founded()

      for (let n = 0; n < INVITES; n += 1) {
        const answered = routes(
          request('POST', invitationsOf('acme'), { as: ann, body: stranger(n) }),
          apart(n),
        )

        await vi.waitFor(() => expect(floor.pending()).toBe(1))
        await floor.advance(300)
        await answered
      }

      // From an address with its mails and invitations untouched: only the admin's limit refuses it.
      const response = await routes(
        request('POST', invitationsOf('acme'), { as: ann, body: stranger(INVITES) }),
        OTHER,
      )

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe(String(IDENTITY_INVITES.windowMs / 1000))
    })

    it('still lets another admin invite from another address when one is refused', async () => {
      const { root, ann, bob, ask, founded } = await harness()

      await founded()
      ;(
        await root.organisations.create({ identity: bob.identity.id, key: 'bobco', name: 'Bob Co' })
      )._unsafeUnwrap()

      for (let n = 0; n <= INVITES; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      expect(
        (
          await ask('POST', invitationsOf('bobco'), {
            as: bob,
            from: '203.0.113.2',
            body: stranger(0),
          })
        ).status,
      ).toBe(201)
    })

    it("takes an address's invites the contract allows across three admins and answers the next 429", async () => {
      const { root, ann, bob, cat, ask, founded, limits } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()
      ;(
        await root.organisations.create({ identity: bob.identity.id, key: 'bobco', name: 'Bob Co' })
      )._unsafeUnwrap()
      ;(
        await root.organisations.create({ identity: cat.identity.id, key: 'catco', name: 'Cat Co' })
      )._unsafeUnwrap()

      // Two admins fill the address's invitations: ann all of hers, bob the rest. Every invitation
      // also takes one of the address's mails, so its invitations can refuse only while it has more
      // mails than invitations: no other address tells the two apart.
      expect(ADDRESS_MAILS.limit).toBeGreaterThan(ADDRESS_INVITES.limit)

      const fromBob = ADDRESS_INVITES.limit - INVITES

      expect(fromBob).toBeGreaterThan(0)
      expect(fromBob).toBeLessThanOrEqual(INVITES)

      for (let n = 0; n < INVITES; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      for (let n = 0; n < fromBob; n += 1) {
        await ask('POST', invitationsOf('bobco'), { as: bob, body: stranger(n) })
      }

      expect(invite).toHaveBeenCalledTimes(ADDRESS_INVITES.limit)
      expect(await ask('POST', invitationsOf('catco'), { as: cat, body: stranger(0) })).toEqual({
        status: 429,
        body: { code: 'rate-limited' },
      })
      expect(invite).toHaveBeenCalledTimes(ADDRESS_INVITES.limit)
      // The address's mails were left: its invitations refused, not its mails.
      expect(limits.verificationMail(ADDRESS).allowed).toBe(true)
      // The same admin from another address is let in: cat's own bucket was charged only once.
      expect(
        (
          await ask('POST', invitationsOf('catco'), {
            as: cat,
            from: '203.0.113.9',
            body: stranger(1),
          })
        ).status,
      ).toBe(201)
    })

    it('counts nothing for an invitation whose body does not follow the schema', async () => {
      const { root, ann, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()

      for (let n = 0; n < INVITES + 10; n += 1) {
        expect(
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            body: { email: 'bob@example.test', role: 'owner' },
          }),
        ).toEqual({ status: 400, body: { code: 'bad-request' } })
      }

      for (let n = 0; n < INVITES; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      expect(invite).toHaveBeenCalledTimes(INVITES)
    })

    it('counts an invitation whose email is not one, though the service is not asked', async () => {
      const { root, ann, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()

      for (let n = 0; n < INVITES; n += 1) {
        expect(
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: apart(n),
            body: { email: 'nope', role: CONTRACT_ROLES.member },
          }),
        ).toEqual({ status: 400, body: { code: 'email-invalid' } })
      }

      // From an address with its mails and invitations untouched: only the admin's limit refuses it.
      expect(
        await ask('POST', invitationsOf('acme'), { as: ann, from: OTHER, body: stranger(0) }),
      ).toEqual({ status: 429, body: { code: 'rate-limited' } })
      expect(invite).not.toHaveBeenCalled()
    })

    it("answers an address's mail past its limit 429, sign-ups and invites together, its invite windows untouched", async () => {
      const { limits, ann, ask, founded } = await harness()

      await founded()

      // ann has invitations left past the five she makes here, so the refusals below could spend some.
      expect(INVITES).toBeGreaterThan(5)

      // All but five of the address's mails went out as sign-ups.
      for (let n = 0; n < ADDRESS_MAILS.limit - 5; n += 1) {
        expect(limits.verificationMail(ADDRESS).allowed).toBe(true)
      }

      for (let n = 0; n < 5; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })).status,
        ).toBe(201)
      }

      // Refused by the address's mails: nothing of ann's invitations nor of the address's is spent.
      for (let n = 5; n < 15; n += 1) {
        expect(await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })).toEqual({
          status: 429,
          body: { code: 'rate-limited' },
        })
      }

      // Other addresses, one each: the rest of ann's invitations are left, and no more.
      for (let n = 15; n < INVITES + 10; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, from: apart(n), body: stranger(n) }))
            .status,
        ).toBe(201)
      }

      expect(
        (
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: OTHER,
            body: stranger(INVITES + 10),
          })
        ).status,
      ).toBe(429)
    })

    it('gives the address its mail back when an invite window refuses the invite', async () => {
      const { limits, ann, ask, founded } = await harness()

      await founded()

      for (let n = 0; n < INVITES; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, from: apart(n), body: stranger(n) }))
            .status,
        ).toBe(201)
      }

      // The admin's window refuses one from another address: that address keeps all its mails.
      expect(
        (
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: OTHER,
            body: stranger(INVITES),
          })
        ).status,
      ).toBe(429)

      for (let n = 0; n < ADDRESS_MAILS.limit; n += 1) {
        expect(limits.verificationMail(OTHER).allowed).toBe(true)
      }

      expect(limits.verificationMail(OTHER).allowed).toBe(false)
    })

    it('lets the admin invite again once the window it started has passed', async () => {
      const { clock, ann, ask, founded } = await harness()

      await founded()

      for (let n = 0; n < INVITES; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, from: apart(n), body: stranger(n) }))
            .status,
        ).toBe(201)
      }

      expect(
        (
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: OTHER,
            body: stranger(INVITES),
          })
        ).status,
      ).toBe(429)

      await clock.advance(IDENTITY_INVITES.windowMs)
      // From an address with its mails and invitations untouched: only the admin's window decides.
      expect(
        (
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: OTHER,
            body: stranger(INVITES + 1),
          })
        ).status,
      ).toBe(201)
    })

    it('answers the 11th organisation an identity creates within an hour 429 and provisions nothing, while another identity still creates', async () => {
      const { root, clock, ann, bob, ask } = await harness()
      const create = vi.spyOn(root.organisations, 'create')

      for (let n = 0; n < 10; n += 1) {
        expect(
          (await ask('POST', '/organisations', { as: ann, body: { key: `org_${n}`, name: 'Org' } }))
            .status,
        ).toBe(201)
      }

      expect(create).toHaveBeenCalledTimes(10)
      expect(
        await ask('POST', '/organisations', { as: ann, body: { key: 'org_10', name: 'Org' } }),
      ).toEqual({ status: 429, body: { code: 'rate-limited' } })
      expect(create).toHaveBeenCalledTimes(10)
      expect(
        (await ask('POST', '/organisations', { as: bob, body: { key: 'bobco', name: 'Bob' } }))
          .status,
      ).toBe(201)
      await clock.advance(60 * minute)
      expect(
        (await ask('POST', '/organisations', { as: ann, body: { key: 'org_10', name: 'Org' } }))
          .status,
      ).toBe(201)
    })

    it('answers the 31st organisation created from one address within an hour 429 and provisions nothing, while another address still creates', async () => {
      const { root, ann, bob, cat, signUp, ask } = await harness()
      const dan = await signUp('dan@example.test')
      const create = vi.spyOn(root.organisations, 'create')
      /** Creates the organisation `key` as `creator`, from the address `from` or the default one. */
      const creates = async (creator: typeof ann, key: string, from?: string) =>
        ask('POST', '/organisations', {
          as: creator,
          body: { key, name: 'Org' },
          ...(from === undefined ? {} : { from }),
        })

      for (let n = 0; n < 10; n += 1) {
        expect((await creates(ann, `ann_${n}`)).status).toBe(201)
      }

      // Refused by ann's own limit: the address is not charged for it.
      expect(await creates(ann, 'ann_10')).toEqual({ status: 429, body: { code: 'rate-limited' } })

      for (const [name, creator] of [
        ['bob', bob],
        ['cat', cat],
      ] as const) {
        for (let n = 0; n < 10; n += 1) {
          expect((await creates(creator, `${name}_${n}`)).status).toBe(201)
        }
      }

      expect(create).toHaveBeenCalledTimes(30)
      expect(await creates(dan, 'dan_0')).toEqual({
        status: 429,
        body: { code: 'rate-limited' },
      })
      expect(create).toHaveBeenCalledTimes(30)
      expect((await creates(dan, 'dan_0', '203.0.113.2')).status).toBe(201)
    })

    it('counts nothing for a creation whose key or name a rule refuses', async () => {
      const { ann, ask } = await harness()

      for (let n = 0; n < 6; n += 1) {
        expect(
          (await ask('POST', '/organisations', { as: ann, body: { key: 'A', name: 'Org' } }))
            .status,
        ).toBe(400)
        expect(
          (await ask('POST', '/organisations', { as: ann, body: { key: 'acme', name: '' } }))
            .status,
        ).toBe(400)
      }

      expect(
        (await ask('POST', '/organisations', { as: ann, body: { key: 'acme', name: 'Acme' } }))
          .status,
      ).toBe(201)
    })
  })
})
