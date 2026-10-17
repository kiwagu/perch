import { describe, expect, it, vi } from 'vitest'

import { publishChange } from './changes'
import { ShapeRunner } from './shape-runner'
import type { LocalDb, Shape } from './types'

function fakeLocal(results: unknown[]): LocalDb {
  const query = vi.fn(() => Promise.resolve([results.shift()]))

  return {
    db: { query } as never,
    changes: new EventTarget(),
    close: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  }
}

const shape: Shape<{ id: string }, { name: string }> = {
  id: 'profile',
  kind: 'shape',
  text: 'SELECT',
  params: [{ name: 'id', type: 'string' }],
  tables: ['identity', 'org'],
}

describe('ShapeRunner.read', () => {
  it('returns the first statement result as the tree', async () => {
    const runner = new ShapeRunner(fakeLocal([{ name: 'a' }]))

    expect((await runner.read(shape, { id: 'identity:1' }))._unsafeUnwrap()).toEqual({ name: 'a' })
  })
})

describe('ShapeRunner.watch', () => {
  it('reruns when one of the shape tables changes and ignores others', async () => {
    vi.useFakeTimers()

    const local = fakeLocal([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    const runner = new ShapeRunner(local)
    const seen: unknown[] = []
    const stop = runner.watch(shape, { id: 'identity:1' }, (tree) => seen.push(tree), {
      debounceMs: 10,
    })

    await vi.runAllTimersAsync()
    publishChange(local, ['post'], 'command')
    await vi.runAllTimersAsync()
    publishChange(local, ['org'], 'command')
    await vi.runAllTimersAsync()
    stop()
    publishChange(local, ['identity'], 'command')
    await vi.runAllTimersAsync()

    expect(seen).toEqual([{ name: 'a' }, { name: 'b' }])

    vi.useRealTimers()
  })

  it('reports a failed run instead of dropping it', async () => {
    vi.useFakeTimers()

    const local: LocalDb = {
      db: { query: () => Promise.reject(new Error('boom')) } as never,
      changes: new EventTarget(),
      close: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    }
    const failures: string[] = []
    const stop = new ShapeRunner(local).watch(shape, { id: 'identity:1' }, () => {}, {
      onError: (error) => failures.push(error.code),
    })

    await vi.runAllTimersAsync()
    stop()

    expect(failures).toEqual(['data:QUERY_FAILED'])

    vi.useRealTimers()
  })
})
