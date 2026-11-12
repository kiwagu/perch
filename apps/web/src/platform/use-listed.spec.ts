// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { useListed } from './use-listed'

describe('useListed', () => {
  it('reads nothing while there is no scope, and the list of a scope once it has one', async () => {
    const read = vi.fn((scope: string) => okAsync([`${scope}-1`]))
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string | undefined }) => useListed(read, scope, 0),
      { initialProps: { scope: undefined as string | undefined } },
    )

    expect(read).not.toHaveBeenCalled()
    expect(result.current).toEqual({ list: undefined, failure: undefined })

    rerender({ scope: 'acme' })

    await waitFor(() => expect(result.current.list).toEqual(['acme-1']))
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads again when another change was made, keeping the list until it is read', async () => {
    let reads = 0
    const read = vi.fn(() => okAsync([`read-${++reads}`]))
    const { result, rerender } = renderHook(
      ({ changed }: { changed: number }) => useListed(read, 'acme', changed),
      { initialProps: { changed: 0 } },
    )

    await waitFor(() => expect(result.current.list).toEqual(['read-1']))

    rerender({ changed: 1 })

    expect(result.current.list).toEqual(['read-1'])
    await waitFor(() => expect(result.current.list).toEqual(['read-2']))
  })

  it("keeps the list read before a failed read, with the failure's code", async () => {
    let fail = false
    const read = vi.fn(() => (fail ? errAsync({ code: 'not-admin' }) : okAsync(['one'])))
    const { result, rerender } = renderHook(
      ({ changed }: { changed: number }) => useListed(read, 'acme', changed),
      { initialProps: { changed: 0 } },
    )

    await waitFor(() => expect(result.current.list).toEqual(['one']))

    fail = true
    rerender({ changed: 1 })

    await waitFor(() => expect(result.current.failure).toBe('not-admin'))
    expect(result.current.list).toEqual(['one'])
  })

  it('says which count of changes the latest settled read was made for, a failed one included', async () => {
    let fail = false
    const read = vi.fn(() => (fail ? errAsync({ code: 'not-admin' }) : okAsync(['one'])))
    const { result, rerender } = renderHook(
      ({ changed }: { changed: number }) => useListed(read, 'acme', changed),
      { initialProps: { changed: 0 } },
    )

    expect(result.current.settled).toBeUndefined()

    await waitFor(() => expect(result.current.settled).toBe(0))

    rerender({ changed: 1 })

    // The read for the change has not settled yet: the list shown is the one read before it.
    expect(result.current.settled).toBe(0)
    await waitFor(() => expect(result.current.settled).toBe(1))

    fail = true
    rerender({ changed: 2 })

    await waitFor(() => expect(result.current.settled).toBe(2))
    expect(result.current.failure).toBe('not-admin')
  })

  it('shows nothing of another scope until it is read', async () => {
    const read = vi.fn((scope: string) => okAsync([scope]))
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string | undefined }) => useListed(read, scope, 0),
      { initialProps: { scope: 'acme' as string | undefined } },
    )

    await waitFor(() => expect(result.current.list).toEqual(['acme']))

    rerender({ scope: 'globex' })

    expect(result.current).toEqual({ list: undefined, failure: undefined })
    await waitFor(() => expect(result.current.list).toEqual(['globex']))

    rerender({ scope: undefined })

    expect(result.current).toEqual({ list: undefined, failure: undefined })
  })
})

/** A paged list's source as a screen writes it: `q` from the search, the page and its size. */
const PAGED = { params: { q: { search: 'q' } }, paged: true }

/** A read of `search` that settles when the test says, with the search it was read for. */
function deferredReads() {
  const pending: Array<{
    readonly search: Readonly<Record<string, unknown>>
    readonly settle: () => void
  }> = []
  const read = (search: Readonly<Record<string, unknown>>) =>
    ResultAsync.fromSafePromise(
      new Promise<string>((resolve) => {
        pending.push({ search, settle: () => resolve(JSON.stringify(search)) })
      }),
    )

  return { pending, read }
}

describe('useListed scoped by the search', () => {
  it("reads again for each new value of a search key its source reads, and for no other key's", async () => {
    const read = vi.fn((search: Readonly<Record<string, unknown>>) =>
      okAsync(`${String(search['q'])}-${String(search['page'])}`),
    )
    const { result, rerender } = renderHook(
      ({ search }: { search: Readonly<Record<string, unknown>> }) =>
        useListed(() => read(search), 'ann', 0, { source: PAGED, search }),
      { initialProps: { search: { q: 'ann', page: 1, size: 25 } as Record<string, unknown> } },
    )

    await waitFor(() => expect(result.current.list).toBe('ann-1'))

    rerender({ search: { q: 'ann', page: 2, size: 25 } })

    await waitFor(() => expect(result.current.list).toBe('ann-2'))

    rerender({ search: { q: 'ann', page: 2, size: 25, view: 'compact' } })

    expect(read).toHaveBeenCalledTimes(2)
    expect(result.current.list).toBe('ann-2')
  })

  it('shows nothing of the earlier search until the new one is read', async () => {
    const { pending, read } = deferredReads()
    const { result, rerender } = renderHook(
      ({ search }: { search: Readonly<Record<string, unknown>> }) =>
        useListed(() => read(search), 'ann', 0, { source: PAGED, search }),
      { initialProps: { search: { q: 'ann', page: 1, size: 25 } as Record<string, unknown> } },
    )

    act(() => pending[0]?.settle())
    await waitFor(() => expect(result.current.list).toBeDefined())

    rerender({ search: { q: 'bob', page: 1, size: 25 } })

    expect(result.current).toEqual({ list: undefined, failure: undefined })

    act(() => pending[1]?.settle())

    await waitFor(() =>
      expect(result.current.list).toBe(JSON.stringify({ q: 'bob', page: 1, size: 25 })),
    )
  })

  it('drops a read whose search changed before it settled: its answer is shown nowhere', async () => {
    const { pending, read } = deferredReads()
    const { result, rerender } = renderHook(
      ({ search }: { search: Readonly<Record<string, unknown>> }) =>
        useListed(() => read(search), 'ann', 0, { source: PAGED, search }),
      { initialProps: { search: { q: 'ann', page: 1, size: 25 } as Record<string, unknown> } },
    )

    rerender({ search: { q: 'ann', page: 1, size: 10 } })

    const [first, second] = pending

    await act(async () => {
      second?.settle()
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(result.current.list).toBe(JSON.stringify({ q: 'ann', page: 1, size: 10 })),
    )

    await act(async () => {
      first?.settle()
      await Promise.resolve()
    })

    expect(result.current.list).toBe(JSON.stringify({ q: 'ann', page: 1, size: 10 }))
  })
})
