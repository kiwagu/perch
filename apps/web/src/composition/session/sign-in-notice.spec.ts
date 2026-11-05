import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'
import { memoryStorage, savedNotice, saveNotice } from '../storage'

import { SignInNotice } from './sign-in-notice'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

const SLOT = [undefined, ...SESSION_NOTICES]
const PAIRS = SLOT.flatMap((own) => SLOT.map((browsers) => [own, browsers] as const))

/** Where `word` stands in the rank of `SESSION_NOTICES`; no word stands after every word. */
const standing = (word: SessionNotice | undefined): number =>
  word === undefined ? SESSION_NOTICES.length : SESSION_NOTICES.indexOf(word)

describe("the word of this tab's sign-in page", () => {
  it.each(PAIRS)(
    "says the first by the rank of this tab's own %s and the browser's %s",
    (own, browsers) => {
      const storage = memoryStorage()
      const notice = new SignInNotice(storage)

      if (own !== undefined) {
        notice.leave(own, undefined)
      }

      if (browsers !== undefined) {
        saveNotice(storage, browsers)
      }

      expect(notice.read()).toBe(standing(own) <= standing(browsers) ? own : browsers)
    },
  )

  it("says the browser's word while this tab left none, and takes it", () => {
    const storage = memoryStorage()
    const notice = new SignInNotice(storage)

    expect(notice.read()).toBeUndefined()

    saveNotice(storage, 'signed-out-elsewhere')

    expect(notice.read()).toBe('signed-out-elsewhere')

    notice.take()

    expect(notice.read()).toBeUndefined()
    expect(savedNotice(storage)).toBeUndefined()
  })

  it("says this tab's own word over the browser's word on why a session ended, written before or after it", () => {
    const storage = memoryStorage()
    const notice = new SignInNotice(storage)

    saveNotice(storage, 'signed-out-elsewhere')
    notice.leave('password-reset-elsewhere', undefined)

    expect(notice.read()).toBe('password-reset-elsewhere')

    // A session of another tab ends later and leaves its word: this tab's own stays.
    saveNotice(storage, 'password-changed-elsewhere')

    expect(notice.read()).toBe('password-reset-elsewhere')

    notice.take()

    expect(notice.read()).toBeUndefined()
    expect(savedNotice(storage)).toBeUndefined()
  })

  it("says the browser's word on what became of the device's data over this tab's own", () => {
    const storage = memoryStorage()
    const notice = new SignInNotice(storage)

    notice.leave('signed-out-elsewhere', ann)
    saveNotice(storage, 'resend-after-sign-in')

    expect(notice.read()).toBe('resend-after-sign-in')

    saveNotice(storage, 'delete-pending')

    expect(notice.read()).toBe('delete-pending')

    notice.take()

    expect(notice.read()).toBeUndefined()
  })

  it('keeps each waiting tab its own word, whichever sign-in page opens first', () => {
    const storage = memoryStorage()
    const first = new SignInNotice(storage)
    const second = new SignInNotice(storage)

    first.leave('password-reset-elsewhere', undefined)
    second.leave('signed-out-elsewhere', undefined)

    // The second tab's page opens first, says its word and takes the words it read.
    expect(second.read()).toBe('signed-out-elsewhere')
    second.take()

    expect(first.read()).toBe('password-reset-elsewhere')
  })

  it('drops its own word once another account signs in in this tab, and keeps it for its own account', () => {
    const storage = memoryStorage()
    const guest = new SignInNotice(storage)
    const anns = new SignInNotice(storage)

    guest.leave('password-reset-elsewhere', undefined)
    guest.signedIn(ann)

    expect(guest.read()).toBeUndefined()

    anns.leave('signed-out-elsewhere', ann)
    anns.signedIn(ann)

    expect(anns.read()).toBe('signed-out-elsewhere')

    anns.signedIn(bob)

    expect(anns.read()).toBeUndefined()
  })
})
