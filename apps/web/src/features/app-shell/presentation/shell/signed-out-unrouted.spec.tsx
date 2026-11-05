// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeSession } from '../../../../platform/__fixtures__/session'
import type { SessionPort } from '../../../../platform/session.port'

import { useSignedOutUnrouted } from './signed-out-unrouted'

/** Who the session says is signed in, as its subscribers hear it. */
type SignedIn = Parameters<Parameters<SessionPort['subscribe']>[0]>[0]

/** A session whose subscribers the test tells who is signed in now. */
function tellingSession(): {
  readonly session: SessionPort
  tell(user: SignedIn): void
} {
  const listeners = new Set<(user: SignedIn) => void>()
  const session: SessionPort = {
    ...fakeSession().session,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }

  return {
    session,
    tell: (user) => {
      for (const listener of listeners) {
        listener(user)
      }
    },
  }
}

const ann: NonNullable<SignedIn> = { id: identityIdFactory.create(), email: 'ann@example.test' }

describe('useSignedOutUnrouted', () => {
  it('tells the frame the account went away while it renders no screen, and only then', () => {
    const { session, tell } = tellingSession()
    const actor = { send: vi.fn() }
    const { rerender, unmount } = renderHook(
      ({ noScreen }) => useSignedOutUnrouted(session, actor, noScreen),
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

  it('hears nothing before the session exists', () => {
    const actor = { send: vi.fn() }
    const { unmount } = renderHook(() => useSignedOutUnrouted(undefined, actor, true))

    expect(actor.send).not.toHaveBeenCalled()
    unmount()
  })
})
