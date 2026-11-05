// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeSession } from '../../../../platform/__fixtures__/session'
import type { SessionPort } from '../../../../platform/session.port'

import { useSignedOutUnrouted } from './signed-out-unrouted'

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

describe('useSignedOutUnrouted', () => {
  it('tells the frame the account it shows went away while it renders no screen, and only then', () => {
    const { session, tell } = tellingSession(ann)
    const actor = { send: vi.fn() }
    const { rerender, unmount } = renderHook(
      ({ noScreen }) => useSignedOutUnrouted(session, actor, noScreen, () => ann.id),
      { initialProps: { noScreen: true } },
    )

    tell(ann)
    expect(actor.send).not.toHaveBeenCalled()

    tell(undefined)
    expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })

    // A screen renders: the shell's container hears the account from now on.
    rerender({ noScreen: false })
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
      const { unmount } = renderHook(() => useSignedOutUnrouted(session, actor, true, () => ann.id))

      expect(actor.send).toHaveBeenCalledExactlyOnceWith({ type: 'platform.signed-out' })
      unmount()
    },
  )

  it("tells the frame of a guest's start nothing as it starts listening", () => {
    const { session } = tellingSession(undefined)
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() =>
      useSignedOutUnrouted(session, actor, true, () => undefined),
    )

    expect(actor.send).not.toHaveBeenCalled()
    unmount()
  })

  it('hears nothing before the session exists', () => {
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOutUnrouted(undefined, actor, true, () => ann.id))

    expect(actor.send).not.toHaveBeenCalled()
    unmount()
  })
})
