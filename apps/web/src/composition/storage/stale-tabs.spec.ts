import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { laggingStorage } from '../__fixtures__/lagging-storage'

import { memoryStorage } from './key-value'
import { savedMemberships, saveMemberships } from './memberships'
import { markSignIn } from './notice'
import {
  forgetDevice,
  saveDevice,
  savedIdentity,
  savedSession,
  savedTokenOf,
  saveIdentityEmail,
  TOKEN_KEY,
  tokenRecord,
} from './signed-in'

/** The counter each sign-in moves (`markSignIn`), as the browser keeps it. */
const SIGN_INS_KEY = 'perch.session.sign-ins'

const membership = (key: string): Membership => ({
  tenant: { id: tenantIdFactory.create(), key, name: key },
  role: 'member',
})

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [membership('ann-co')],
}

/** Ann signed in again: a new session, with the email she has by then. */
const annAgain = {
  identity: { ...ann.identity, email: 'ann@third.example.test' },
  token: 'token-ann-2',
  memberships: ann.memberships,
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
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test', savedSession(confirming))
    browser.deliver()

    expect(savedIdentity(confirming)).toBeUndefined()
    expect(savedIdentity(signingOut)).toBeUndefined()
  })
})

describe('the email a confirmation keeps', () => {
  it('is read over the email the identity signed in with, while the session it was asked in lasts', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test', savedSession(storage))

    expect(savedIdentity(storage)).toEqual({ id: ann.identity.id, email: 'ann@new.example.test' })
    expect(savedTokenOf(storage, ann.identity.id)).toBe(ann.token)
  })

  it("is not kept for an identity that is not the one signed in, nor read for another's", () => {
    const storage = memoryStorage()

    saveDevice(storage, bob)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test', savedSession(storage))

    expect(savedIdentity(storage)).toEqual(bob.identity)
  })

  it('goes with a sign-out, and a later sign-in of the identity reads the email it signed in with', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test', savedSession(storage))
    forgetDevice(storage)

    expect(savedIdentity(storage)).toBeUndefined()

    saveDevice(storage, annAgain)

    expect(savedIdentity(storage)?.email).toBe('ann@third.example.test')
  })
  it('writes nothing for a confirmation asked while no session was kept, whatever session its answer finds', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveIdentityEmail(storage, ann.identity.id, 'ann@fourth.example.test', savedSession(storage))
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test', undefined)

    expect(savedIdentity(storage)?.email).toBe('ann@fourth.example.test')
  })
})

describe('a confirmation answered in a tab that hears the others late', () => {
  it('brings back nothing a sign-out overtook, and gives way to the email of a later sign-in', () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const other = browser.tab()

    saveDevice(confirming, ann)
    browser.deliver()
    forgetDevice(other)
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test', savedSession(confirming))
    browser.deliver()

    expect(savedIdentity(confirming)).toBeUndefined()

    saveDevice(other, annAgain)
    browser.deliver()

    expect(savedIdentity(confirming)?.email).toBe('ann@third.example.test')
  })

  it("does not stand over the email of the identity's next sign-in, landed before it", () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const other = browser.tab()

    saveDevice(other, ann)
    markSignIn(other)
    browser.deliver()

    // The confirmation is asked in Ann's session, which another tab ends and signs her in again,
    // with the email she has now; its answer comes to a tab that has not heard of that.
    const asked = savedSession(confirming)

    forgetDevice(other)
    saveDevice(other, annAgain)
    markSignIn(other)
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test', asked)
    browser.deliver()

    expect(savedIdentity(confirming)?.email).toBe('ann@third.example.test')
    expect(savedIdentity(other)?.email).toBe('ann@third.example.test')
  })

  it('keeps the email a tab confirms once it heard the sign-in, before it heard the sign-in moved its mark', () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const other = browser.tab()

    saveDevice(other, ann)
    markSignIn(other)
    browser.deliver((key) => key !== SIGN_INS_KEY)

    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test', savedSession(confirming))
    browser.deliver()

    expect(savedIdentity(confirming)?.email).toBe('ann@new.example.test')
    expect(savedIdentity(other)?.email).toBe('ann@new.example.test')
  })

  it("keeps the current sign-in's confirmation when an earlier one's answer comes late", () => {
    const browser = laggingStorage()
    const confirming = browser.tab()
    const other = browser.tab()

    saveDevice(other, ann)
    markSignIn(other)
    browser.deliver()

    // A confirmation asked in Ann's first sign-in waits for its answer.
    const first = savedSession(confirming)

    forgetDevice(other)
    saveDevice(other, annAgain)
    markSignIn(other)
    browser.deliver()
    saveIdentityEmail(
      confirming,
      ann.identity.id,
      'ann@fourth.example.test',
      savedSession(confirming),
    )
    browser.deliver()
    // The first one's answer comes now.
    saveIdentityEmail(confirming, ann.identity.id, 'ann@new.example.test', first)
    browser.deliver()

    expect(savedIdentity(confirming)?.email).toBe('ann@fourth.example.test')
    expect(savedIdentity(other)?.email).toBe('ann@fourth.example.test')
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
