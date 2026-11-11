import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Container } from '@workspace/di'
import { loadScreens } from '@workspace/ui-contract'

import { FakeAccounts } from '../../platform/__fixtures__/accounts'
import { ACCOUNTS } from '../../platform/accounts.port'

import { ACCOUNTS_SERVICE } from './application/accounts.service'
import { ConsoleModule } from './console.module'
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

  it("routes operators to the platform's accounts, the size they chose kept across a search", () => {
    expect(ConsoleModule.routes).toEqual([
      {
        path: '/console/users',
        page: 'UsersPage',
        roles: ['operator'],
        history: 'push',
        retain: ['size'],
        search: AccountSearchSchema,
      },
    ])
    expect(Object.keys(ConsoleModule.declarations)).toEqual(['UsersPage'])
  })

  it("reads the list from where the contract's list does", () => {
    const { screens } = loadScreens(ROOT)
    const users = screens?.screens.find((screen) => screen.id === 'console.users')

    expect(users?.anchors['console.users.list']?.source).toEqual(ACCOUNTS_LIST_SOURCE)
  })
})
