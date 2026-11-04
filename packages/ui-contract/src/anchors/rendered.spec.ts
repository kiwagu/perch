import { describe, expect, it } from 'vitest'

import { isListed, isRendered, renderedAt } from './rendered'

/** A sign-in screen with modes, and an area of independent regions, as a flow writes them. */
const FLOW = {
  initial: 'sign-in',
  states: {
    'sign-in': { meta: { renders: ['x.y.forgot-link'] } },
    'sign-up': { meta: { renders: ['x.y.rule-list', 'x.y.name-input'] } },
    'signing-up': { meta: { renders: ['x.y.rule-list', 'x.y.name-input'] } },
    'check-mail': { meta: { renders: ['x.y.forgot-link', 'x.y.resend-button'] } },
    viewing: {
      type: 'parallel',
      meta: { renders: ['x.y.panel'] },
      states: {
        form: {
          initial: 'closed',
          states: { closed: {}, open: { meta: { renders: ['x.y.form'] } } },
        },
        side: { initial: 'idle', states: { idle: {} } },
      },
    },
  },
}

describe('what a state renders', () => {
  it('renders an anchor no state lists in every state', () => {
    for (const value of ['sign-in', 'sign-up', { viewing: { form: 'closed', side: 'idle' } }]) {
      const at = renderedAt(FLOW, value)

      expect(isListed(at, 'x.y.email-input')).toBe(false)
      expect(isRendered(at, 'x.y.email-input')).toBe(true)
    }
  })

  it('renders a listed anchor only in the states that list it', () => {
    expect(isRendered(renderedAt(FLOW, 'sign-in'), 'x.y.forgot-link')).toBe(true)
    expect(isRendered(renderedAt(FLOW, 'check-mail'), 'x.y.forgot-link')).toBe(true)
    expect(isRendered(renderedAt(FLOW, 'sign-up'), 'x.y.forgot-link')).toBe(false)
    expect(isRendered(renderedAt(FLOW, 'signing-up'), 'x.y.name-input')).toBe(true)
    expect(isListed(renderedAt(FLOW, 'sign-up'), 'x.y.forgot-link')).toBe(true)
  })

  it('renders what is nested under a listed anchor with it, a derived part included', () => {
    const signUp = renderedAt(FLOW, 'sign-up')
    const signIn = renderedAt(FLOW, 'sign-in')

    expect(isListed(signIn, 'x.y.rule-list.length-item')).toBe(true)
    expect(isRendered(signUp, 'x.y.rule-list.length-item')).toBe(true)
    expect(isRendered(signIn, 'x.y.rule-list.length-item')).toBe(false)
    expect(isRendered(signUp, 'x.y.name-input.visibility-button')).toBe(true)
    expect(isRendered(signIn, 'x.y.name-input.visibility-button')).toBe(false)
  })

  it('keeps an anchor whose nested anchor alone is listed in every state', () => {
    const at = renderedAt(
      { states: { a: { meta: { renders: ['x.y.form.name-input'] } }, b: {} } },
      'b',
    )

    expect(isListed(at, 'x.y.form')).toBe(false)
    expect(isRendered(at, 'x.y.form')).toBe(true)
    expect(isRendered(at, 'x.y.form.name-input')).toBe(false)
  })

  it("renders in a region's state what it lists and what its parallel state lists", () => {
    const open = renderedAt(FLOW, { viewing: { form: 'open', side: 'idle' } })
    const closed = renderedAt(FLOW, { viewing: { form: 'closed', side: 'idle' } })

    expect(isRendered(open, 'x.y.form')).toBe(true)
    expect(isRendered(open, 'x.y.panel')).toBe(true)
    expect(isRendered(closed, 'x.y.form')).toBe(false)
    expect(isRendered(closed, 'x.y.panel')).toBe(true)
    expect(isRendered(renderedAt(FLOW, 'sign-in'), 'x.y.panel')).toBe(false)
  })

  it('reads a state the config does not hold, or a name every object has, as listing nothing', () => {
    const running = renderedAt(FLOW, { viewing: { form: 'running', side: 'idle' } })

    expect(isRendered(running, 'x.y.panel')).toBe(true)
    expect(isRendered(running, 'x.y.form')).toBe(false)
    expect(isRendered(renderedAt(FLOW, 'constructor'), 'x.y.forgot-link')).toBe(false)
    expect(renderedAt(undefined, 'sign-in')).toEqual({ listed: [], rendered: [] })
  })

  it('lists each name once', () => {
    expect(renderedAt(FLOW, 'sign-in').listed).toEqual([
      'x.y.forgot-link',
      'x.y.rule-list',
      'x.y.name-input',
      'x.y.resend-button',
      'x.y.panel',
      'x.y.form',
    ])
    expect(renderedAt(FLOW, 'check-mail').rendered).toEqual([
      'x.y.forgot-link',
      'x.y.resend-button',
    ])
  })
})
