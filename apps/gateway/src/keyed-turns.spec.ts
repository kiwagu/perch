import { describe, expect, it } from 'vitest'

import { KeyedTurns } from './keyed-turns'

describe('keyed turns', () => {
  it('runs the turns of one key one after the other, and those of another key beside them', async () => {
    const turns = new KeyedTurns<string>()
    const order: string[] = []
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = turns.run('laptop', async () => {
      order.push('laptop 1 starts')
      await held
      order.push('laptop 1 ends')

      return 1
    })
    const second = turns.run('laptop', async () => {
      order.push('laptop 2 starts')

      return 2
    })
    const phone = turns.run('phone', async () => {
      order.push('phone starts')

      return 3
    })

    expect(await phone).toBe(3)
    release()

    expect(await Promise.all([first, second])).toEqual([1, 2])
    expect(order).toEqual(['laptop 1 starts', 'phone starts', 'laptop 1 ends', 'laptop 2 starts'])
  })

  it('starts the next turn after one that failed, and answers each with its own outcome', async () => {
    const turns = new KeyedTurns<string>()
    const failed = turns.run('laptop', () => Promise.reject(new Error('refused')))
    const next = turns.run('laptop', async () => 'next')

    await expect(failed).rejects.toThrow('refused')
    expect(await next).toBe('next')
  })

  it('forgets a key once its last turn settled', async () => {
    const turns = new KeyedTurns<string>()

    await turns.run('laptop', async () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(turns.size).toBe(0)
  })
})
