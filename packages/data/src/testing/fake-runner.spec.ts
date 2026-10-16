import { describe, expect, it } from 'vitest'

import type { Shape } from '../types'

import { FakeShapeRunner } from './fake-runner'

const shape: Shape<{ id: string }, { name: string }> = {
  id: 'x.profile',
  kind: 'shape',
  text: '',
  params: [],
  tables: ['profile'],
}

describe('FakeShapeRunner', () => {
  it('answers reads and pushes trees to watchers of a shape until they stop', async () => {
    const runner = new FakeShapeRunner().set(shape, { name: 'Ann' })
    const seen: unknown[] = []
    const stop = runner.watch(shape, { id: '1' }, (tree) => seen.push(tree))

    runner.set(shape, { name: 'Anna' })
    stop()
    runner.set(shape, { name: 'Ignored' })

    expect((await runner.read(shape, { id: '1' }))._unsafeUnwrap()).toEqual({ name: 'Ignored' })
    expect(seen).toEqual([{ name: 'Ann' }, { name: 'Anna' }])
    expect(runner.watching(shape)).toBe(0)
    expect(runner.lastParams(shape)).toEqual({ id: '1' })
  })
})
