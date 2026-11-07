import { afterEach, describe, expect, it, vi } from 'vitest'

import { ADDRESS, closeHarness, harness, request } from '../__fixtures__/organisation-routes'

afterEach(closeHarness)

describe('organisationRoutes', () => {
  describe('limits', () => {
    const minute = 60_000

    /** The path an admin invites on. */
    const invitationsOf = (key: string) => `/organisations/${key}/invitations`

    /** The body inviting the n-th email nobody has an account for: accepted, and an attempt. */
    const stranger = (n: number) => ({ email: `stranger-${n}@example.test`, role: 'member' })

    it("lets an admin's 30 invites within 10 minutes reach the service, unknown emails included, and answers the 31st 429 without calling it", async () => {
      const { root, ann, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()

      for (let n = 0; n < 30; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })).status,
        ).toBe(201)
      }

      expect(invite).toHaveBeenCalledTimes(30)

      const refused = await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(30) })

      expect(refused).toEqual({ status: 429, body: { code: 'rate-limited' } })
      expect(invite).toHaveBeenCalledTimes(30)
    })

    it('answers 429 with Retry-After in whole seconds', async () => {
      const { routes, floor, ann, founded } = await harness()

      await founded()

      for (let n = 0; n < 30; n += 1) {
        const answered = routes(
          request('POST', invitationsOf('acme'), { as: ann, body: stranger(n) }),
          ADDRESS,
        )

        await vi.waitFor(() => expect(floor.pending()).toBe(1))
        await floor.advance(300)
        await answered
      }

      const response = await routes(
        request('POST', invitationsOf('acme'), { as: ann, body: stranger(30) }),
        ADDRESS,
      )

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe('600')
    })

    it('still lets another admin invite from another address when one is refused', async () => {
      const { root, ann, bob, ask, founded } = await harness()

      await founded()
      ;(
        await root.organisations.create({ identity: bob.identity.id, key: 'bobco', name: 'Bob Co' })
      )._unsafeUnwrap()

      for (let n = 0; n <= 30; n += 1) {
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

    it('takes 60 invites from one address across three admins and answers the 61st 429', async () => {
      const { root, ann, bob, cat, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()
      ;(
        await root.organisations.create({ identity: bob.identity.id, key: 'bobco', name: 'Bob Co' })
      )._unsafeUnwrap()
      ;(
        await root.organisations.create({ identity: cat.identity.id, key: 'catco', name: 'Cat Co' })
      )._unsafeUnwrap()

      for (let n = 0; n < 30; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
        await ask('POST', invitationsOf('bobco'), { as: bob, body: stranger(n) })
      }

      expect(invite).toHaveBeenCalledTimes(60)
      expect(await ask('POST', invitationsOf('catco'), { as: cat, body: stranger(0) })).toEqual({
        status: 429,
        body: { code: 'rate-limited' },
      })
      expect(invite).toHaveBeenCalledTimes(60)
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

      for (let n = 0; n < 40; n += 1) {
        expect(
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            body: { email: 'bob@example.test', role: 'owner' },
          }),
        ).toEqual({ status: 400, body: { code: 'bad-request' } })
      }

      for (let n = 0; n < 30; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      expect(invite).toHaveBeenCalledTimes(30)
    })

    it('counts an invitation whose email is not one, though the service is not asked', async () => {
      const { root, ann, ask, founded } = await harness()
      const invite = vi.spyOn(root.organisations.invitations, 'invite')

      await founded()

      for (let n = 0; n < 30; n += 1) {
        expect(
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            body: { email: 'nope', role: 'member' },
          }),
        ).toEqual({ status: 400, body: { code: 'email-invalid' } })
      }

      expect(await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(0) })).toEqual({
        status: 429,
        body: { code: 'rate-limited' },
      })
      expect(invite).not.toHaveBeenCalled()
    })

    it('answers the 201st mail of an address 429, sign-ups and invites together, its invite windows untouched', async () => {
      const { limits, ann, ask, founded } = await harness()

      await founded()

      // 195 of the address's mails went out as sign-ups.
      for (let n = 0; n < 195; n += 1) {
        expect(limits.verificationMail(ADDRESS).allowed).toBe(true)
      }

      for (let n = 0; n < 5; n += 1) {
        expect(
          (await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })).status,
        ).toBe(201)
      }

      // Refused by the address's mails: nothing of ann's 30 nor of the address's 60 is spent.
      for (let n = 5; n < 15; n += 1) {
        expect(await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })).toEqual({
          status: 429,
          body: { code: 'rate-limited' },
        })
      }

      // Another address: 25 more of ann's 30 are left.
      for (let n = 15; n < 40; n += 1) {
        expect(
          (
            await ask('POST', invitationsOf('acme'), {
              as: ann,
              from: '203.0.113.9',
              body: stranger(n),
            })
          ).status,
        ).toBe(201)
      }

      expect(
        (
          await ask('POST', invitationsOf('acme'), {
            as: ann,
            from: '203.0.113.9',
            body: stranger(40),
          })
        ).status,
      ).toBe(429)
    })

    it('gives the address its mail back when an invite window refuses the invite', async () => {
      const { limits, ann, ask, founded } = await harness()

      await founded()

      for (let n = 0; n < 31; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      // 30 of the address's 200 mails went out: the refused 31st invite took none.
      for (let n = 0; n < 170; n += 1) {
        expect(limits.verificationMail(ADDRESS).allowed).toBe(true)
      }

      expect(limits.verificationMail(ADDRESS).allowed).toBe(false)
    })

    it('lets the admin invite again 10 minutes after the window started', async () => {
      const { clock, ann, ask, founded } = await harness()

      await founded()

      for (let n = 0; n <= 30; n += 1) {
        await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(n) })
      }

      await clock.advance(10 * minute)
      expect(
        (await ask('POST', invitationsOf('acme'), { as: ann, body: stranger(31) })).status,
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

    it('counts nothing for a creation whose body does not follow the schema', async () => {
      const { ann, ask } = await harness()

      for (let n = 0; n < 12; n += 1) {
        expect(
          (await ask('POST', '/organisations', { as: ann, body: { key: 'A', name: 'Org' } }))
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
