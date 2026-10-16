import { describe, expect, it } from 'vitest'

import { Container, token } from './container'

interface Clock {
  now(): number
}

const CLOCK = token<Clock>('Clock')
const GREETING = token<string>('Greeting')

describe('Container', () => {
  it('creates a singleton once and returns the cached instance afterwards', () => {
    let created = 0
    const container = new Container().singleton(CLOCK, () => {
      created++

      return { now: () => 42 }
    })

    const first = container.get(CLOCK)

    expect(container.get(CLOCK)).toBe(first)
    expect(first.now()).toBe(42)
    expect(created).toBe(1)
  })

  it('passes the container to factories so they can resolve dependencies', () => {
    const container = new Container()
      .singleton(CLOCK, () => ({ now: () => 7 }))
      .singleton(GREETING, (c) => `time ${c.get(CLOCK).now()}`)

    expect(container.get(GREETING)).toBe('time 7')
  })

  it('lets a child resolve from its parent and override locally', () => {
    const parent = new Container().singleton(GREETING, () => 'parent')
    const child = parent.child()

    expect(child.get(GREETING)).toBe('parent')

    child.singleton(GREETING, () => 'child')

    expect(child.get(GREETING)).toBe('child')
    expect(parent.get(GREETING)).toBe('parent')
  })

  it('names the token when nothing is bound', () => {
    expect(() => new Container().child().get(CLOCK)).toThrow(/no provider bound for Clock/)
  })
})
