import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { ACCOUNT_START_KEY, keptAccountStart } from './account-start'
import { memoryStorage } from './key-value'

const start = { identity: identityIdFactory.create(), name: 'Ann', locale: 'es' as const }

describe('the kept account start', () => {
  it('keeps one start for the tabs of the browser until it is forgotten', () => {
    const storage = memoryStorage()

    keptAccountStart(storage).keep(start)

    // Another tab of the browser reads it.
    expect(keptAccountStart(storage).kept()).toEqual(start)

    keptAccountStart(storage).forget()

    expect(keptAccountStart(storage).kept()).toBeUndefined()
    expect(storage.get(ACCOUNT_START_KEY)).toBeUndefined()
  })

  it.each([
    ['not JSON', '{'],
    ['an identity that is not one', JSON.stringify({ ...start, identity: 'nobody' })],
    ['a language the app does not speak', JSON.stringify({ ...start, locale: 'fr' })],
    ['no name', JSON.stringify({ ...start, name: '' })],
  ])('takes a kept value with %s for none', (_, value) => {
    const storage = memoryStorage()

    storage.set(ACCOUNT_START_KEY, value)

    expect(keptAccountStart(storage).kept()).toBeUndefined()
  })
})
