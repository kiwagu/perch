// @vitest-environment jsdom
/**
 * The console's pages bring their code only to an operator: any other device at their addresses
 * gets the not-found page, and none of their code is loaded for it.
 */

import { describe, expect, it, vi } from 'vitest'

import { GUEST, IDENTITY } from '@workspace/ui-contract/anchors'

import { routerOf } from '../../platform/__fixtures__/router'
import { NotFoundModule } from '../not-found/not-found.module'

import { ConsoleModule } from './console.module'

/** The console's pages whose code has been loaded, by name. */
const loaded = vi.hoisted(() => new Set<string>())

vi.mock('./presentation/pages/users/users.container', (original) => {
  loaded.add('users')

  return original()
})

vi.mock('./presentation/pages/account/account.container', (original) => {
  loaded.add('account')

  return original()
})

/** Every set of roles but an operator's. */
const REFUSED: readonly (readonly string[])[] = [
  [GUEST],
  [IDENTITY],
  [IDENTITY, 'member'],
  [IDENTITY, 'admin'],
]

/** The router of the console at `path` for a device holding `roles`, loaded; nothing renders it. */
async function opened(roles: readonly string[], path: string) {
  const router = routerOf([ConsoleModule, NotFoundModule], roles, path)

  await router.load()

  return router.state.matches.at(-1)
}

describe("the console's pages", () => {
  it('load their code only once an operator opens them: any other device gets the not-found page and loads none of it', async () => {
    for (const roles of REFUSED) {
      for (const path of ['/console/users', '/console/account?id=idn_ann']) {
        expect((await opened(roles, path))?.status, `${roles.join(' ')} at ${path}`).toBe(
          'notFound',
        )
      }
    }

    expect([...loaded]).toEqual([])

    expect((await opened([IDENTITY, 'operator'], '/console/users'))?.status).toBe('success')
    expect([...loaded]).toEqual(['users'])

    expect((await opened([IDENTITY, 'operator'], '/console/account?id=idn_ann'))?.status).toBe(
      'success',
    )
    expect([...loaded]).toEqual(['users', 'account'])
  })
})
