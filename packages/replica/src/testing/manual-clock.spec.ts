import { describe, expect, it } from 'vitest'

import { manualClock } from './manual-clock'

describe('manual clock', () => {
  it('runs the tasks that fall due in the order of their time, and no others', async () => {
    const clock = manualClock(1_000)
    const ran: string[] = []

    clock.schedule(300, () => ran.push(`late at ${clock.now()}`))
    clock.schedule(100, () => ran.push(`first at ${clock.now()}`))
    clock.schedule(100, () => ran.push(`second at ${clock.now()}`))
    const cancel = clock.schedule(200, () => ran.push('cancelled'))

    cancel()
    await clock.advance(250)

    expect(ran).toEqual(['first at 1100', 'second at 1100'])
    expect(clock.now()).toBe(1_250)
    expect(clock.pending()).toBe(1)
  })

  it('lets the promise callbacks a task queued run before the next task', async () => {
    const clock = manualClock()
    const ran: string[] = []

    clock.schedule(10, () => {
      void Promise.resolve().then(() => ran.push('callback of the first'))
    })
    clock.schedule(20, () => ran.push('second'))

    await clock.advance(20)

    expect(ran).toEqual(['callback of the first', 'second'])
  })
})
