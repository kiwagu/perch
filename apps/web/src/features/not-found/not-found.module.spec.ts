import { describe, expect, it } from 'vitest'

import { NotFoundModule } from './not-found.module'

describe('NotFoundModule', () => {
  it('takes every address no other route takes, for anyone', () => {
    expect(NotFoundModule.routes).toEqual([{ path: '/$', page: 'NotFoundPage' }])
    expect(Object.keys(NotFoundModule.declarations)).toEqual(['NotFoundPage'])
    expect(NotFoundModule.providers).toEqual([])
  })
})
