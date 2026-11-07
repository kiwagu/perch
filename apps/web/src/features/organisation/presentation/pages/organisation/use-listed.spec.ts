// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
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
