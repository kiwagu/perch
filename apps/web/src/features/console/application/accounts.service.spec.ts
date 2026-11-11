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
})
