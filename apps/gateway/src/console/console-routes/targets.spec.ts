import { describe, expect, it } from 'vitest'

import { ACCOUNT_ACTIONS, CONSOLE_PATHS, targetOf } from './targets'

/** A path of the table with each parameter given a text. */
const filled = (template: string): string => template.replace(/:\w+/g, 'x')

describe('targetOf', () => {
  it('names a target for each path the console lists: the accounts, an account, each action', () => {
    expect(CONSOLE_PATHS).toHaveLength(2 + ACCOUNT_ACTIONS.length)
    expect(CONSOLE_PATHS.map((template) => targetOf(filled(template)))).toEqual([
      { kind: 'accounts' },
      { kind: 'account', id: 'x' },
      ...ACCOUNT_ACTIONS.map((action) => ({ kind: 'action', id: 'x', action })),
    ])
  })

  it('names no target for a path the console does not list', () => {
    for (const path of [
      '/console',
      '/console/accounts/',
      '/console/accounts/x/',
      '/console/accounts/x/unknown',
      '/console/accounts/x/ban/more',
      '/console/account/x',
      '/console/accounts//ban',
    ]) {
      expect(targetOf(path), path).toBeUndefined()
    }
  })
})
