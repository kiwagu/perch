import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { ensured } from './ensured'

/**
 * A record created when the store holds none: a create the document refuses because the record is
 * there after all is done once the projection shows it; any other failure stays the caller's.
 */
describe('ensured', () => {
  const failure = { code: 'refused' } as const

  it('creates the record when the store holds none', async () => {
    const create = vi.fn(() => okAsync<void, typeof failure>(undefined))

    const result = await ensured(
      () => okAsync([]),
      create,
      () => okAsync(undefined),
    )

    expect(result.isOk()).toBe(true)
    expect(create).toHaveBeenCalledOnce()
  })

  it('creates nothing when the store holds the record already', async () => {
    const create = vi.fn(() => okAsync<void, typeof failure>(undefined))

    const result = await ensured(
      () => okAsync([{ id: 'one' }]),
      create,
      () => okAsync(undefined),
    )

    expect(result.isOk()).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes a refused create as done once the projection shows the record', async () => {
    const rows: unknown[][] = [[], [{ id: 'one' }]]
    const projected = vi.fn(() => okAsync<void, typeof failure>(undefined))

    const result = await ensured(
      () => okAsync(rows.shift() ?? []),
      () => errAsync(failure),
      projected,
    )

    expect(result.isOk()).toBe(true)
    expect(projected).toHaveBeenCalledOnce()
  })

  it('keeps a refused create the failure when the projection still shows no record', async () => {
    const result = await ensured(
      () => okAsync([]),
      () => errAsync(failure),
      () => okAsync(undefined),
    )

    expect(result._unsafeUnwrapErr()).toBe(failure)
  })
})
