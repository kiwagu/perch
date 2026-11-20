// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import { identityIdFactory } from '@workspace/ids'

import { fakeSession } from '../../../../platform/__fixtures__/session'
import type { SessionPort } from '../../../../platform/session.port'
import { NOTHING_SEEN } from '../../application/setting-writes'
import { createShellMachine } from '../../application/shell-machine'

import { useSignedIn } from './signed-in'

/** Who the session says is signed in, as its subscribers hear it. */
type SignedIn = Parameters<Parameters<SessionPort['subscribe']>[0]>[0]

const ann: NonNullable<SignedIn> = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob: NonNullable<SignedIn> = { id: identityIdFactory.create(), email: 'bob@example.test' }

/**
 * A tab's session signed in as `now` and its frame's machine, started as the session's start
 * leaves it: a guest's frame ready, or a saved account's whose data did not open. The test tells
 * the session's subscribers who is signed in next; `cleared` counts the frame's clears of the
 * sign-in page's notice, and `dropped` the words the session dropped.
 */
function tab(now: SignedIn) {
  const listeners = new Set<(user: SignedIn) => void>()
  let current = now
  const dropNotice = vi.fn()
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    dropNotice,
  }
  const actor = createActor(
    createShellMachine({
      values: () => ({ account: now?.id, stored: undefined, writes: NOTHING_SEEN, unsaved: false }),
      signOutHere: () => okAsync(undefined),
      reload: vi.fn(),
      setTheme: vi.fn(),
      followTheme: vi.fn(),
      selfReloads: { done: () => false, mark: vi.fn() },
      install: { prompt: () => Promise.resolve(), postpone: vi.fn() },
    }),
  ).start()
  let cleared = 0

  actor.on('clear', ({ anchor }) => {
    if (anchor === 'user.sign-in.notice-message') {
      cleared += 1
    }
  })
  actor.send({ type: 'platform.started' })

  if (now !== undefined) {
    actor.send({ type: 'platform.open-failed' })
  }

  return {
    session,
    actor,
    tell: (user: SignedIn) => {
      current = user

      for (const listener of listeners) {
        listener(user)
      }
    },
    cleared: () => cleared,
    dropped: () => dropNotice.mock.calls.length,
  }
}

describe('useSignedIn', () => {
  it('tells the frame of each account the session tells after nobody, or after another account', () => {
    const { session, actor, tell, cleared } = tab(undefined)

    renderHook(() => useSignedIn(session, actor, false))

    tell(ann)
    expect(cleared()).toBe(1)

    // Told again (its data opened, or its email changed): no sign-in.
    tell(ann)
    expect(cleared()).toBe(1)

    tell(bob)
    expect(cleared()).toBe(2)

    tell(undefined)
    expect(cleared()).toBe(2)

    // The same account again after nobody: it signed in once more.
    tell(bob)
    expect(cleared()).toBe(3)
  })

  it('takes the account the session shows as listening begins for one signed in before this page', () => {
    const { session, actor, tell, cleared } = tab(ann)

    renderHook(() => useSignedIn(session, actor, true))

    // The start's open of the saved account tells it again: no sign-in.
    tell(ann)
    expect(cleared()).toBe(0)
  })

  it("drops the sign-in page's words through the session while the frame renders no screen, and leaves them to the shell's container once it does", () => {
    const { session, actor, tell, cleared, dropped } = tab(ann)
    const { rerender, unmount } = renderHook(
      ({ noScreen }) => useSignedIn(session, actor, noScreen),
      { initialProps: { noScreen: true } },
    )

    // Another tab signs the saved account out and in again while its data did not open here.
    tell(undefined)
    tell(ann)
    expect(cleared()).toBe(1)
    expect(dropped()).toBe(1)

    rerender({ noScreen: false })
    tell(undefined)
    tell(bob)
    expect(cleared()).toBe(2)
    expect(dropped()).toBe(1)

    unmount()
    tell(undefined)
    tell(ann)
    expect(cleared()).toBe(2)
  })
})
