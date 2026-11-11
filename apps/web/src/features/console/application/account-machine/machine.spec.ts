import { describe, expect, it } from 'vitest'
import { createActor, waitFor } from 'xstate'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { fakeFetch, respond } from '../../../../composition/__fixtures__/gateway-fetch'
import { accountsApi } from '../../../../composition/accounts-api'
import { FakeAccounts, una } from '../../../../platform/__fixtures__/accounts'
import type { AccountsPort } from '../../../../platform/accounts.port'
import { AccountsService } from '../accounts.service'

import { type AccountEmitted, type AccountEvent, createAccountMachine } from './machine'

/** The card's machine over `accounts`, for Una's account, running, with what it emitted. */
function running(accounts: AccountsPort = new FakeAccounts(), id: IdentityId = una.id) {
  const actor = createActor(createAccountMachine({ id, accounts: new AccountsService(accounts) }))
  const emitted: AccountEmitted[] = []

  actor.on('*', (event) => emitted.push(event))
  actor.start()

  return { actor, emitted }
}

/** Waits until every area of the card is idle again: each action sent has ended. */
const settled = (actor: ReturnType<typeof running>['actor']) =>
  waitFor(actor, (snapshot) =>
    Object.values(snapshot.value === 'removed' ? {} : snapshot.value.viewing).every(
      (state) => state === 'idle',
    ),
  )

const toast = (code: string) => ({ type: 'show', anchor: 'app-shell.toast', codes: [code] })

/** One area of the card: the event of its control, the call it makes, its toast and error. */
interface Area {
  readonly area: string
  readonly event: AccountEvent
  readonly call: readonly unknown[]
  readonly toast: string
  readonly clears?: string
  /** A code of its own the area's error shows, as the fake is told to refuse it. */
  readonly refuse: (accounts: FakeAccounts) => string
}

const AREAS: readonly Area[] = [
  {
    area: 'name',
    event: { type: 'console.account.name.save-button', name: 'Una Smith' },
    call: ['rename', una.id, 'Una Smith'],
    toast: 'name-saved',
    refuse: (accounts) => {
      accounts.refuse('rename', 'name-too-long')

      return 'name-too-long'
    },
  },
  {
    area: 'email',
    event: { type: 'console.account.email.send-button', email: 'una@example.org' },
    call: ['changeEmail', una.id, 'una@example.org'],
    toast: 'email-change-sent',
    clears: 'console.account.email.email-input',
    refuse: (accounts) => {
      accounts.refuse('changeEmail', 'email-taken')

      return 'email-taken'
    },
  },
  {
    area: 'ban',
    event: { type: 'console.account.ban.ban-button', reason: 'spam' },
    call: ['ban', una.id, 'spam'],
    toast: 'ban-set',
    clears: 'console.account.ban.reason-input',
    refuse: (accounts) => {
      accounts.refuse('ban', 'own-account')

      return 'own-account'
    },
  },
  {
    area: 'ban',
    event: { type: 'console.account.ban.unban-button' },
    call: ['unban', una.id],
    toast: 'ban-lifted',
    refuse: (accounts) => {
      accounts.refuse('unban', 'account-gone')

      return 'account-gone'
    },
  },
  {
    area: 'sessions',
    event: { type: 'console.account.sessions.revoke-button' },
    call: ['revokeSessions', una.id],
    toast: 'sessions-revoked',
    refuse: (accounts) => {
      accounts.refuse('revokeSessions', 'own-account')

      return 'own-account'
    },
  },
  {
    area: 'reset',
    event: { type: 'console.account.reset.send-button' },
    call: ['sendReset', una.id],
    toast: 'reset-sent',
    refuse: (accounts) => {
      accounts.refuse('sendReset', 'rate-limited')

      return 'rate-limited'
    },
  },
  {
    area: 'verification',
    event: { type: 'console.account.verification.resend-button' },
    call: ['resendVerification', una.id],
    toast: 'verification-sent',
    refuse: (accounts) => {
      accounts.refuse('resendVerification', 'verified-before')

      return 'verified-before'
    },
  },
]

describe('the account card as its flow says', () => {
  it('starts viewing the account with every area idle, no error and no read asked', () => {
    const { actor } = running()

    expect(actor.getSnapshot().value).toEqual({
      viewing: {
        name: 'idle',
        email: 'idle',
        ban: 'idle',
        sessions: 'idle',
        reset: 'idle',
        verification: 'idle',
        removal: 'idle',
      },
    })
    expect(actor.getSnapshot().context).toEqual({ errors: {}, sectionReads: 0 })
  })

  it.each(AREAS)(
    '$event.type runs its action on the account, reads the card again and says so in a toast',
    async ({ event, call, toast: code, clears }) => {
      const accounts = new FakeAccounts()
      const { actor, emitted } = running(accounts)

      actor.send(event)
      await settled(actor)

      expect(accounts.calls).toEqual([call])
      expect(actor.getSnapshot().context.sectionReads).toBe(1)
      expect(emitted).toEqual([
        ...(clears === undefined ? [] : [{ type: 'clear', anchor: clears }]),
        toast(code),
      ])
    },
  )

  it.each(AREAS)(
    '$event.type refused shows its code in its area, reads the card again and raises no toast',
    async ({ area, event, refuse }) => {
      const accounts = new FakeAccounts()
      const { actor, emitted } = running(accounts)
      const code = refuse(accounts)

      actor.send(event)
      await settled(actor)

      expect(actor.getSnapshot().context).toEqual({ errors: { [area]: code }, sectionReads: 1 })
      expect(emitted).toEqual([])
    },
  )

  it('forgets an error of an area once its next action is done, and keeps the others', async () => {
    const accounts = new FakeAccounts()
    const { actor } = running(accounts)

    accounts.refuse('sendReset', 'rate-limited')
    accounts.refuse('ban', 'own-account')
    actor.send({ type: 'console.account.reset.send-button' })
    actor.send({ type: 'console.account.ban.ban-button', reason: '' })
    await settled(actor)

    actor.send({ type: 'console.account.ban.unban-button' })
    await settled(actor)

    expect(actor.getSnapshot().context.errors).toEqual({ reset: 'rate-limited' })
  })

  it('runs one action of an area at a time, the other areas free meanwhile', () => {
    const accounts = new FakeAccounts()
    const { actor } = running(accounts)

    accounts.hold = true
    actor.send({ type: 'console.account.ban.ban-button', reason: '' })

    const snapshot = actor.getSnapshot()

    expect(snapshot.value).toMatchObject({ viewing: { ban: 'banning' } })
    expect(snapshot.can({ type: 'console.account.ban.unban-button' })).toBe(false)
    expect(snapshot.can({ type: 'console.account.ban.ban-button', reason: '' })).toBe(false)
    expect(snapshot.can({ type: 'console.account.sessions.revoke-button' })).toBe(true)
    expect(snapshot.can({ type: 'console.account.removal.remove-button' })).toBe(true)
  })

  it('moves to the accounts once the account is removed, says so in a toast, and ends', async () => {
    const accounts = new FakeAccounts()
    const { actor, emitted } = running(accounts)

    actor.send({ type: 'console.account.removal.remove-button' })
    await waitFor(actor, (snapshot) => snapshot.status === 'done')

    expect(actor.getSnapshot().value).toBe('removed')
    expect(accounts.calls).toEqual([['remove', una.id]])
    expect(accounts.rows.some((row) => row.id === una.id)).toBe(false)
    expect(emitted).toEqual([{ type: 'navigate', to: '/console/users' }, toast('account-removed')])
    expect(actor.getSnapshot().context.sectionReads).toBe(0)
  })

  it.each(['last-admin', 'own-account'] as const)(
    'stays on the card when the removal is refused with %s, its code in the removal area',
    async (code) => {
      const accounts = new FakeAccounts()
      const { actor, emitted } = running(accounts)

      accounts.refuse('remove', code)
      actor.send({ type: 'console.account.removal.remove-button' })
      await settled(actor)

      expect(actor.getSnapshot().status).toBe('active')
      expect(actor.getSnapshot().context).toEqual({ errors: { removal: code }, sectionReads: 1 })
      expect(emitted).toEqual([])
    },
  )

  it('shows account-gone for an action on an account no longer there', async () => {
    const { actor } = running(new FakeAccounts(), identityIdFactory.create())

    actor.send({ type: 'console.account.sessions.revoke-button' })
    await settled(actor)

    expect(actor.getSnapshot().context.errors).toEqual({ sessions: 'account-gone' })
  })
})

describe('the account card over the gateway', () => {
  it("shows not-operator in the area and takes operator off the asker's roles (R28)", async () => {
    const asker = identityIdFactory.create()
    const dropped: Array<readonly [IdentityId, PlatformRole]> = []
    const gateway = accountsApi('/backend', {
      credentials: () => ({ identity: asker, token: 'token-asker' }),
      device: () => 'device-1',
      dropRole: (identity, role) => {
        dropped.push([identity, role])
      },
      fetcher: fakeFetch(respond(403, { code: 'not-operator' })).fetcher,
    })
    const { actor, emitted } = running(gateway)

    actor.send({ type: 'console.account.sessions.revoke-button' })
    await settled(actor)

    expect(actor.getSnapshot().context.errors).toEqual({ sessions: 'not-operator' })
    expect(dropped).toEqual([[asker, 'operator']])
    expect(emitted).toEqual([])
  })
})
