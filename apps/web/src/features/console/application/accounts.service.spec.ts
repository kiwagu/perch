import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { bart, FakeAccounts, opal, refusedWith, una } from '../../../platform/__fixtures__/accounts'

import { AccountsService } from './accounts.service'

describe('AccountsService', () => {
  it('reads the page of accounts the search names, newest first, with how many it finds', async () => {
    const accounts = new FakeAccounts()
    const service = new AccountsService(accounts)

    expect((await service.list({ q: '', page: 1, size: 10 }))._unsafeUnwrap()).toEqual({
      accounts: [bart, una, opal],
      total: 3,
    })
    expect((await service.list({ q: 'UNA', page: 1, size: 10 }))._unsafeUnwrap()).toEqual({
      accounts: [una],
      total: 1,
    })
    expect(accounts.calls).toEqual([
      ['list', { q: '', page: 1, size: 10 }],
      ['list', { q: 'UNA', page: 1, size: 10 }],
    ])
  })

  it("fails with the list's own code", async () => {
    const accounts = new FakeAccounts()

    accounts.refusal = refusedWith('not-operator')

    expect(
      (await new AccountsService(accounts).list({ q: '', page: 1, size: 25 }))._unsafeUnwrapErr()
        .code,
    ).toBe('not-operator')
  })

  it('reads one account, and fails with account-gone for an id no account has', async () => {
    const service = new AccountsService(new FakeAccounts())

    expect((await service.read(una.id))._unsafeUnwrap()).toMatchObject({ id: una.id, name: 'Una' })
    expect((await service.read(identityIdFactory.create()))._unsafeUnwrapErr().code).toBe(
      'account-gone',
    )
  })

  it('acts on an account through the port, each action with what it takes', async () => {
    const accounts = new FakeAccounts()
    const service = new AccountsService(accounts)

    for (const acted of [
      service.rename(una.id, 'Una Smith'),
      service.changeEmail(una.id, 'una@example.org'),
      service.ban(una.id, 'spam'),
      service.unban(una.id),
      service.revokeSessions(una.id),
      service.sendReset(una.id),
      service.resendVerification(una.id),
      service.remove(una.id),
    ]) {
      expect((await acted).isOk()).toBe(true)
    }

    expect(accounts.calls).toEqual([
      ['rename', una.id, 'Una Smith'],
      ['changeEmail', una.id, 'una@example.org'],
      ['ban', una.id, 'spam'],
      ['unban', una.id],
      ['revokeSessions', una.id],
      ['sendReset', una.id],
      ['resendVerification', una.id],
      ['remove', una.id],
    ])
  })

  it("fails with an action's own code", async () => {
    const accounts = new FakeAccounts()
    const service = new AccountsService(accounts)

    accounts.refuse('remove', 'last-admin')
    accounts.refuse('changeEmail', 'email-taken')

    expect((await service.remove(bart.id))._unsafeUnwrapErr().code).toBe('last-admin')
    expect((await service.changeEmail(bart.id, 'una@example.test'))._unsafeUnwrapErr().code).toBe(
      'email-taken',
    )
    expect((await service.remove(bart.id)).isOk()).toBe(true)
  })
})
