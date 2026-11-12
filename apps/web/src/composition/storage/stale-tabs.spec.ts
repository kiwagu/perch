import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { laggingStorage } from '../__fixtures__/lagging-storage'

import { memoryStorage } from './key-value'
import { savedMemberships, saveMemberships } from './memberships'
import {
  forgetDevice,
  saveDevice,
  savedIdentity,
  savedTokenOf,
  saveIdentityEmail,
  TOKEN_KEY,
  tokenRecord,
} from './signed-in'

const membership = (key: string): Membership => ({
  tenant: { id: tenantIdFactory.create(), key, name: key },
  role: 'member',
})

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [membership('ann-co')],
}

const bob = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [membership('bob-co')],
}

describe('the saved session, written by tabs that hear each other late', () => {
  it("keeps Bob's memberships when a tab that has not heard of his sign-in writes Ann's list", () => {
    const browser = laggingStorage()
    const signingIn = browser.tab()
    const stale = browser.tab()

    saveDevice(signingIn, ann)
    browser.deliver()

    // One tab signs Ann out and Bob in; the other, still showing Ann, hears her list meanwhile.
    forgetDevice(signingIn)
    saveDevice(signingIn, bob)
    saveMemberships(stale, ann.identity.id, [membership('ann-co'), membership('ann-new')])
    browser.deliver()

    expect(savedMemberships(signingIn, bob.identity.id)).toEqual(bob.memberships)
    expect(savedMemberships(stale, bob.identity.id)).toEqual(bob.memberships)
  })

  it('brings back no identity whose email a tab confirms after another tab signed it out', () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const signingOut = browser.tab()

    saveDevice(confirming, ann)
    browser.deliver()

    forgetDevice(signingOut)
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test')
    browser.deliver()

    expect(savedIdentity(confirming)).toBeUndefined()
    expect(savedIdentity(signingOut)).toBeUndefined()
  })
})

describe('the email a confirmation keeps', () => {
  it('is read over the email the identity signed in with, while that identity is signed in', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test')

    expect(savedIdentity(storage)).toEqual({ id: ann.identity.id, email: 'ann@new.example.test' })
    expect(savedTokenOf(storage, ann.identity.id)).toBe(ann.token)
  })

  it("is not kept for an identity that is not the one signed in, nor read for another's", () => {
    const storage = memoryStorage()

    saveDevice(storage, bob)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test')

    expect(savedIdentity(storage)).toEqual(bob.identity)
  })

  it('goes with a sign-out, and a later sign-in of the identity reads the email it signed in with', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test')
    forgetDevice(storage)

    expect(savedIdentity(storage)).toBeUndefined()

    saveDevice(storage, { ...ann, identity: { ...ann.identity, email: 'ann@third.example.test' } })

    expect(savedIdentity(storage)?.email).toBe('ann@third.example.test')
  })

  it('left behind by a confirmation a sign-out overtook, gives way to the email of a later sign-in', () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const other = browser.tab()

    saveDevice(confirming, ann)
    browser.deliver()
    forgetDevice(other)
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test')
    browser.deliver()

    saveDevice(other, { ...ann, identity: { ...ann.identity, email: 'ann@third.example.test' } })
    browser.deliver()

    expect(savedIdentity(confirming)?.email).toBe('ann@third.example.test')
  })
})

describe("a sign-in's save that broke before the identity", () => {
  it('leaves nothing of the identity once the device is forgotten: the token names whose it was', () => {
    const storage = memoryStorage()

    // The token and the memberships landed; the identity's write did not.
    storage.set(TOKEN_KEY, tokenRecord(ann.identity.id, ann.token))
    saveMemberships(storage, ann.identity.id, ann.memberships)
    forgetDevice(storage)

    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    expect(savedTokenOf(storage, ann.identity.id)).toBeUndefined()
  })
})
