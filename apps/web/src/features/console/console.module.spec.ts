import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Container } from '@workspace/di'
import { loadScreens } from '@workspace/ui-contract'
import { z } from '@workspace/zod'

import { FakeAccounts } from '../../platform/__fixtures__/accounts'
import { ACCOUNTS } from '../../platform/accounts.port'

import { ACCOUNTS_SERVICE } from './application/accounts.service'
import { ConsoleModule } from './console.module'
import { ACCOUNT_SECTION_SOURCE, AccountCardSearchSchema } from './domain/account-card.entity'
import { ACCOUNTS_LIST_SOURCE, AccountSearchSchema } from './domain/account-search.entity'

const ROOT = join(import.meta.dirname, '../../../../..')

describe('ConsoleModule', () => {
  it("provides the accounts service over the console's port", async () => {
    const container = new Container().singleton(ACCOUNTS, () => new FakeAccounts()).child()

    for (const provider of ConsoleModule.providers) {
      container.singleton(provider.provide, provider.useFactory)
    }

    const page = (
      await container.get(ACCOUNTS_SERVICE).list({ q: '', page: 1, size: 25 })
    )._unsafeUnwrap()

    expect(page.total).toBe(3)
  })

  it("routes operators to the platform's accounts, the size they chose kept across a search, and to an account's card", () => {
    expect(ConsoleModule.routes).toEqual([
      {
        path: '/console/users',
        page: 'UsersPage',
        roles: ['operator'],
        history: 'push',
        retain: ['size'],
        search: AccountSearchSchema,
      },
      {
        path: '/console/account',
        page: 'AccountPage',
        roles: ['operator'],
        history: 'push',
        search: AccountCardSearchSchema,
      },
    ])
    expect(Object.keys(ConsoleModule.declarations)).toEqual(['UsersPage', 'AccountPage'])
  })

  it("reads the list from where the contract's list does", () => {
    const { screens } = loadScreens(ROOT)
    const users = screens?.screens.find((screen) => screen.id === 'console.users')

    expect(users?.anchors['console.users.list']?.source).toEqual(ACCOUNTS_LIST_SOURCE)
  })

  it("reads the card from where the contract's section does", () => {
    const { screens } = loadScreens(ROOT)
    const account = screens?.screens.find((screen) => screen.id === 'console.account')

    expect(account?.anchors['console.account.section']?.source).toEqual(ACCOUNT_SECTION_SOURCE)
  })

  it('takes an id of 1 to 64 characters for the card, and none', () => {
    expect(z.parse(AccountCardSearchSchema, { id: 'idn_ann' })).toEqual({ id: 'idn_ann' })
    expect(z.parse(AccountCardSearchSchema, {})).toEqual({})
    expect(z.safeParse(AccountCardSearchSchema, { id: '' }).success).toBe(false)
    expect(z.safeParse(AccountCardSearchSchema, { id: 'i'.repeat(65) }).success).toBe(false)
  })
})
