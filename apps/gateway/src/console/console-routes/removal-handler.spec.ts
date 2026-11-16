import { errAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { deviceHeaders, signUpOn } from '../../auth/__fixtures__/auth-instance'
import {
  holdTurn,
  PASSWORD,
  type SignedInAccount,
  signedInOn,
  signInRequest,
  turnsAsked,
} from '../../auth/auth-handler/__fixtures__/mount'
import { admitted } from '../../tenants/__fixtures__/invitations'
import { type ConsoleMount, consoleOnMount } from '../__fixtures__/console-mount'

/** The account the operator removes. */
const BOB = 'bob@example.test'

/** Another account, a member of bob's organisations. */
const CAT = 'cat@example.test'

/** Another client address, which nothing the operator asks charges. */
const ELSEWHERE = '203.0.113.20'

/** What a command a test starts from answers; one that fails fails the test. */
async function done<T, E>(command: ResultAsync<T, E>): Promise<T> {
  return (await command)._unsafeUnwrap()
}

/** `invitee`, signed in with `email`, joins the organisation `key` through `actor`'s invitation. */
function joins(
  mounted: ConsoleMount,
  actor: SignedInAccount,
  key: string,
  invitee: SignedInAccount,
  email: string,
) {
  return admitted(mounted.organisations, {
    actor: actor.identity,
    key,
    invitee: { id: invitee.identity, email },
  })
}

/** The emails of the members of `key`, as `actor`, one of its admins, reads them. */
async function membersOf(mounted: ConsoleMount, actor: SignedInAccount, key: string) {
  return (await mounted.organisations.membersOf({ actor: actor.identity, key }))
    ._unsafeUnwrap()
    .map((member) => member.identity.email)
}

describe('consoleRoutes: POST /console/accounts/:id/removal', () => {
  it('removes the account as its own deletion does: its sessions end and its sockets close 4001 before its rows go, and again after', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk', 'phone'])

    mounted.steps.splice(0)

    expect(await mounted.act(bob.identity, 'removal')).toEqual({
      status: 204,
      body: undefined,
      retryAfter: null,
    })
    expect(mounted.steps).toEqual([
      'departure',
      'sessions ended',
      `sockets closed ${CLOSE.revoked}`,
      'rows removed',
      `sockets closed ${CLOSE.revoked}`,
    ])
    expect(mounted.closes).toEqual([
      [bob.identity, undefined, CLOSE.revoked],
      [bob.identity, undefined, CLOSE.revoked],
    ])

    for (const device of ['desk', 'phone']) {
      expect(bob.sockets.get(device)?.ended).toEqual([CLOSE.revoked])
      expect((await mounted.sessions.read(bob.tokens.get(device) ?? '')).kind).toBe('none')
    }

    expect(await mounted.card(bob.identity)).toBeUndefined()
    expect((await mounted.sessions.identityOf(BOB))._unsafeUnwrap()).toBeUndefined()
    expect((await mounted.route(signInRequest(BOB, PASSWORD, 'desk'), ELSEWHERE))?.status).toBe(401)
    expect(mounted.consoleFailures).toEqual([])
  })

  it("tells the email the account had, in the account's language, that it is gone", async () => {
    const mounted = await consoleOnMount()
    const { user } = await signUpOn(mounted.auth, BOB, deviceHeaders('desk'), { locale: 'es' })

    expect((await mounted.act(await mounted.identityOf(user.email), 'removal')).status).toBe(204)

    const notice = await mounted.outbox.next(BOB, 1)

    expect(notice.subject).toBe('Tu cuenta de Perch fue eliminada')
    expect(notice.html).toContain('lang="es"')
    expect(notice.text).not.toMatch(/https?:/)
  })

  it('takes the account out of its organisations: one it alone belongs to goes, one with another admin keeps its members', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const cat = await signedInOn(mounted, CAT, ['tablet'])
    const { organisations } = mounted

    await done(organisations.create({ identity: bob.identity, key: 'solo', name: 'Solo' }))
    await done(organisations.create({ identity: bob.identity, key: 'shared', name: 'Shared' }))
    await joins(mounted, bob, 'shared', cat, CAT)
    await done(
      organisations.setRole({
        actor: bob.identity,
        key: 'shared',
        identity: cat.identity,
        role: 'admin',
      }),
    )

    expect((await mounted.act(bob.identity, 'removal')).status).toBe(204)
    expect(await membersOf(mounted, cat, 'shared')).toEqual([CAT])
    // The organisation bob alone belonged to went, so its key is free again.
    expect(
      (await organisations.create({ identity: cat.identity, key: 'solo', name: 'Solo' })).isOk(),
    ).toBe(true)
  })

  it('answers 409 last-admin, changing nothing, while it is the only admin of an organisation with other members', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const cat = await signedInOn(mounted, CAT, ['tablet'])

    await done(
      mounted.organisations.create({ identity: bob.identity, key: 'shared', name: 'Shared' }),
    )
    await joins(mounted, bob, 'shared', cat, CAT)
    mounted.steps.splice(0)

    expect(await mounted.act(bob.identity, 'removal')).toEqual({
      status: 409,
      body: { code: 'last-admin' },
      retryAfter: null,
    })
    expect(mounted.steps).toEqual(['departure'])
    expect(mounted.closes).toEqual([])
    expect((await mounted.sessions.read(bob.tokens.get('desk') ?? '')).kind).toBe('session')
    expect(await membersOf(mounted, bob, 'shared')).toEqual([BOB, CAT])
    expect(mounted.outbox.to(BOB)).toHaveLength(1)
    expect(mounted.consoleFailures).toEqual([])

    // Once cat is gone, bob is removed with the organisation.
    await done(
      mounted.organisations.remove({ actor: bob.identity, key: 'shared', identity: cat.identity }),
    )
    expect((await mounted.act(bob.identity, 'removal')).status).toBe(204)
  })

  it("refuses the operator's own account 409 own-account before taking its turn, changing nothing", async () => {
    const mounted = await consoleOnMount()
    const asked = turnsAsked(mounted.turns)

    mounted.steps.splice(0)

    expect(await mounted.act(mounted.operator.identity, 'removal')).toEqual({
      status: 409,
      body: { code: 'own-account' },
      retryAfter: null,
    })
    expect(asked(mounted.operator.identity)).toBe(0)
    expect(mounted.steps).toEqual([])
    expect((await mounted.sessions.read(mounted.operator.token)).kind).toBe('session')
  })

  it('completes a removal that failed part way when it is asked again, telling the email once', async () => {
    let failing = true
    const failure = dataError('data:WRITE_FAILED', 'the rows could not be removed')
    const mounted = await consoleOnMount({
      teardown: (real) => ({
        addressee: (identity) => real.addressee(identity),
        remove: (identity) => {
          if (failing) {
            failing = false

            return errAsync(failure)
          }

          return real.remove(identity)
        },
      }),
    })
    const bob = await signedInOn(mounted, BOB, ['desk'])

    await done(mounted.organisations.create({ identity: bob.identity, key: 'solo', name: 'Solo' }))

    expect(await mounted.act(bob.identity, 'removal')).toMatchObject({
      status: 500,
      body: { code: 'internal' },
    })
    expect(mounted.consoleFailures).toEqual([failure])
    // It left its organisations and its devices, the account itself still there, told nothing.
    expect(await mounted.card(bob.identity)).toMatchObject({ organisations: [] })
    expect(bob.sockets.get('desk')?.ended).toEqual([CLOSE.revoked])
    expect(mounted.outbox.to(BOB)).toHaveLength(1)

    expect((await mounted.act(bob.identity, 'removal')).status).toBe(204)
    expect(await mounted.card(bob.identity)).toBeUndefined()
    expect((await mounted.outbox.next(BOB, 1)).subject).toBe('Your Perch account was deleted')
    expect(mounted.outbox.to(BOB)).toHaveLength(2)
  })

  it('answers an id no account has, and an id of another form, 404 account-gone', async () => {
    const mounted = await consoleOnMount()

    mounted.steps.splice(0)

    for (const id of [identityIdFactory.create(), 'nonsense']) {
      expect(await mounted.act(id, 'removal')).toMatchObject({
        status: 404,
        body: { code: 'account-gone' },
      })
    }

    expect(mounted.steps).toEqual([])
  })

  it('answers an account removed while the removal waited for its turn 404 account-gone, telling nobody', async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const release = await holdTurn(mounted.turns, bob.identity)
    const asked = turnsAsked(mounted.turns)
    const removing = mounted.act(bob.identity, 'removal')

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))
    ;(await mounted.teardown.remove(bob.identity))._unsafeUnwrap()
    mounted.steps.splice(0)
    release()

    expect(await removing).toMatchObject({ status: 404, body: { code: 'account-gone' } })
    expect(mounted.steps).toEqual([])
    expect(mounted.outbox.to(BOB)).toHaveLength(1)
  })

  it("runs two operators' removals of one account one after the other: the second finds it gone", async () => {
    const mounted = await consoleOnMount()
    const bob = await signedInOn(mounted, BOB, ['desk'])
    const release = await holdTurn(mounted.turns, bob.identity)
    const asked = turnsAsked(mounted.turns)
    const first = mounted.act(bob.identity, 'removal')

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(1))

    const second = mounted.act(bob.identity, 'removal', undefined, mounted.operator, ELSEWHERE)

    await vi.waitFor(() => expect(asked(bob.identity)).toBe(2))
    expect(await mounted.card(bob.identity)).toBeDefined()

    release()

    expect((await first).status).toBe(204)
    expect(await second).toMatchObject({ status: 404, body: { code: 'account-gone' } })
    expect(mounted.outbox.to(BOB)).toHaveLength(2)
  })
})
