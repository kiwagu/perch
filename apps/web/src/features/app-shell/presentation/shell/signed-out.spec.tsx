// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeSession } from '../../../../platform/__fixtures__/session'
import type { SessionPort } from '../../../../platform/session.port'

import { useSignedOut } from './signed-out'

/** Who the session says is signed in, as its subscribers hear it. */
type SignedIn = Parameters<Parameters<SessionPort['subscribe']>[0]>[0]

/** A session signed in as `now`, whose subscribers the test tells who is signed in next. */
function tellingSession(now: SignedIn): {
  readonly session: SessionPort
  tell(user: SignedIn): void
} {
  const listeners = new Set<(user: SignedIn) => void>()
  let current = now
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }

  return {
    session,
    tell: (user) => {
      current = user

      for (const listener of listeners) {
        listener(user)
      }
    },
  }
}

const ann: NonNullable<SignedIn> = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob: NonNullable<SignedIn> = { id: identityIdFactory.create(), email: 'bob@example.test' }

describe('useSignedOut', () => {
  it('tells the frame the account it shows went away while it listens, and only then', () => {
    const { session, tell } = tellingSession(ann)
    const actor = { send: vi.fn() }
    const { rerender, unmount } = renderHook(
      ({ listening }) => useSignedOut(session, actor, listening, () => ann.id),
      { initialProps: { listening: true } },
    )

    tell(ann)
    expect(actor.send).not.toHaveBeenCalled()

    tell(undefined)
    expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })

    // A screen renders: the start stops listening, the shell's container hears the account now.
    rerender({ listening: false })
    tell(undefined)
    expect(actor.send).toHaveBeenCalledOnce()

    unmount()
  })

  it.each([
    ['signed out', undefined],
    ['signed out, and another account signed in since', bob],
  ])(
    'tells the frame, as it starts listening, that the account it shows went away before: %s',
    (_, now) => {
      const { session } = tellingSession(now)
      const actor = { send: vi.fn() }
      const { unmount } = renderHook(() => useSignedOut(session, actor, true, () => ann.id))

      expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })
      unmount()
    },
  )

  it('tells the frame once of a switch the session tells at once: nobody, then another account', () => {
    const { session, tell } = tellingSession(ann)
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOut(session, actor, true, () => ann.id))

    tell(undefined)
    tell(bob)

    expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })
    unmount()
  })

  it('tells the frame of another account the session tells straight after the one it shows', () => {
    const { session, tell } = tellingSession(ann)
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOut(session, actor, true, () => ann.id))

    tell(bob)

    expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })
    unmount()
  })

  it("tells the frame of an account signed in after a guest's start once, when it goes", () => {
    const { session, tell } = tellingSession(undefined)
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOut(session, actor, true, () => undefined))

    tell(ann)
    expect(actor.send).not.toHaveBeenCalled()

    tell(undefined)
    tell(undefined)
    expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })
    unmount()
  })

  it("tells the frame of a guest's start nothing as it starts listening", () => {
    const { session } = tellingSession(undefined)
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOut(session, actor, true, () => undefined))

    expect(actor.send).not.toHaveBeenCalled()
    unmount()
  })

  it('hears nothing before the session exists', () => {
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOut(undefined, actor, true, () => ann.id))

    expect(actor.send).not.toHaveBeenCalled()
    unmount()
  })
})
