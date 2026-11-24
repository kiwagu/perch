import { describe, expect, it } from 'vitest'

import { givesBack, withDefaultLength } from './defaults'

const DEFAULTS = { maxLength: 80 } as const

describe('withDefaultLength', () => {
  it('gives a string value that names no limit the default length, which it lacks as written', () => {
    const written = { type: 'string', minLength: 1, description: 'A name.' } as const

    expect(written).not.toHaveProperty('maxLength')
    expect(withDefaultLength(written, DEFAULTS)).toStrictEqual({ ...written, maxLength: 80 })
  })

  it('keeps a written limit, in its place, whatever the default', () => {
    const written = { type: 'string', maxLength: 254, format: 'email' } as const

    expect(withDefaultLength(written, DEFAULTS)).toStrictEqual(written)
    expect(Object.keys(withDefaultLength(written, DEFAULTS))).toEqual(Object.keys(written))
  })

  it('gives none to an enum, a read-only value, a value that is no string and a null limit', () => {
    const closed = { type: 'string', enum: ['small', 'large'] } as const
    const untyped = { enum: ['member', 'admin'] } as const
    const count = { type: 'integer', minimum: 1 } as const

    expect(withDefaultLength(closed, DEFAULTS)).toStrictEqual(closed)
    expect(withDefaultLength(untyped, DEFAULTS)).toStrictEqual(untyped)
    expect(withDefaultLength(count, DEFAULTS)).toStrictEqual(count)
    expect(withDefaultLength({ type: 'string' }, DEFAULTS, true)).toStrictEqual({ type: 'string' })
    expect(withDefaultLength({ type: 'string', maxLength: null }, DEFAULTS)).toStrictEqual({
      type: 'string',
    })
  })

  it('takes nothing without a default, and leaves a null limit out all the same', () => {
    expect(withDefaultLength({ type: 'string' }, undefined)).toStrictEqual({ type: 'string' })
    expect(
      withDefaultLength({ type: 'string', maxLength: null, minLength: 1 }, undefined),
    ).toStrictEqual({ type: 'string', minLength: 1 })
  })
})

describe('givesBack', () => {
  it('holds for a written limit equal to the default on a value that would take it', () => {
    expect(givesBack({ type: 'string', maxLength: 80 }, DEFAULTS, false)).toBe(true)
  })

  it('does not hold for another number, no default, or a value the default would not reach', () => {
    expect(givesBack({ type: 'string', maxLength: 81 }, DEFAULTS, false)).toBe(false)
    expect(givesBack({ type: 'string', maxLength: 80 }, undefined, false)).toBe(false)
    expect(givesBack({ type: 'string', maxLength: 80 }, DEFAULTS, true)).toBe(false)
    expect(givesBack({ type: 'string', enum: ['a'], maxLength: 80 }, DEFAULTS, false)).toBe(false)
    expect(givesBack({ type: 'integer', maxLength: 80 }, DEFAULTS, false)).toBe(false)
    expect(givesBack({ type: 'string' }, DEFAULTS, false)).toBe(false)
  })
})
