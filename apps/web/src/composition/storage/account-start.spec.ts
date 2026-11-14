import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { signedIn, signedOut } from '../__fixtures__/signed-in'

import { accountStartKeyOf, keptAccountStart } from './account-start'
import { memoryStorage } from './key-value'
import { CURRENT_KEY } from './sign-in'

const start = {
  identity: identityIdFactory.create(),
  name: 'Ann',
  locale: 'es' as const,
}

const ann = { identity: { id: start.identity, email: 'ann@example.test' }, token: 'token-ann' }

describe('the kept account start', () => {
  it('keeps one start under the sign-in that learnt of it, for the tabs of the browser, until it is forgotten', () => {
    const storage = memoryStorage()
    const session = signedIn(storage, ann)

    keptAccountStart(storage).keep(session.signIn, start)

    // Another tab of the browser reads it, for the identity signed in.
    const kept = keptAccountStart(storage).kept(start.identity)

    expect(kept).toEqual({ ...start, signIn: session.signIn })
    expect(keptAccountStart(storage).kept(identityIdFactory.create())).toBeUndefined()

    if (kept) {
      keptAccountStart(storage).forget(kept)
    }

    expect(keptAccountStart(storage).kept(start.identity)).toBeUndefined()
    expect(storage.get(accountStartKeyOf(session.signIn))).toBeUndefined()
  })

  it('goes with the sign-in that kept it', () => {
    const storage = memoryStorage()
    const session = signedIn(storage, ann)

    keptAccountStart(storage).keep(session.signIn, start)
    signedOut(storage)

    expect(keptAccountStart(storage).kept(start.identity)).toBeUndefined()
    expect(storage.get(accountStartKeyOf(session.signIn))).toBeUndefined()
  })

  it("forgets the start it read, never another account's kept since", () => {
    const storage = memoryStorage()
    const bobStart = { ...start, identity: identityIdFactory.create(), name: 'Bob' }
    const first = signedIn(storage, ann)

    keptAccountStart(storage).keep(first.signIn, start)

    const read = keptAccountStart(storage).kept(start.identity)

    // Ann signs out and Bob in, whose start is kept; the finish of Ann's start ends after that.
    signedOut(storage)

    const next = signedIn(storage, {
      identity: { id: bobStart.identity, email: 'bob@example.test' },
      token: 'token-bob',
    })

    keptAccountStart(storage).keep(next.signIn, bobStart)
    expect(read).toEqual({ ...start, signIn: first.signIn })

    if (read) {
      keptAccountStart(storage).forget(read)
    }

    expect(keptAccountStart(storage).kept(bobStart.identity)).toEqual({
      ...bobStart,
      signIn: next.signIn,
    })
  })

  it("forgets the start it read, never the one the same account's next sign-in kept", () => {
    const storage = memoryStorage()
    const first = signedIn(storage, ann)

    keptAccountStart(storage).keep(first.signIn, start)

    const read = keptAccountStart(storage).kept(start.identity)

    signedOut(storage)

    const again = signedIn(storage, ann)

    keptAccountStart(storage).keep(again.signIn, start)

    if (read) {
      keptAccountStart(storage).forget(read)
    }

    expect(keptAccountStart(storage).kept(start.identity)?.signIn).toBe(again.signIn)
  })

  it.each([
    ['not JSON', '{'],
    ['an identity that is not one', JSON.stringify({ ...start, identity: 'nobody' })],
    ['a language the app does not speak', JSON.stringify({ ...start, locale: 'fr' })],
    ['no name', JSON.stringify({ ...start, name: '' })],
  ])('takes a kept value with %s for none', (_, value) => {
    const storage = memoryStorage()

    storage.set(CURRENT_KEY, 'sign-in')
    storage.set(accountStartKeyOf('sign-in'), value)

    expect(keptAccountStart(storage).kept(start.identity)).toBeUndefined()
  })
})
