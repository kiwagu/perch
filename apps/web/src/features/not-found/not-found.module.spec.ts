import { describe, expect, it } from 'vitest'

import { CONTRACT_ROLES, CONTRACT_ROUTES } from '@workspace/kernel'

import { NotFoundModule } from './not-found.module'

describe('NotFoundModule', () => {
  it('takes every address no other route takes, for anyone', () => {
    expect(NotFoundModule.routes).toEqual([
      {
        path: CONTRACT_ROUTES['not-found'],
        page: 'NotFoundPage',
        roles: [
          CONTRACT_ROLES.guest,
          CONTRACT_ROLES.identity,
          CONTRACT_ROLES.member,
          CONTRACT_ROLES.admin,
        ],
      },
    ])
    expect(Object.keys(NotFoundModule.declarations)).toEqual(['NotFoundPage'])
    expect(NotFoundModule.providers).toEqual([])
  })
})
