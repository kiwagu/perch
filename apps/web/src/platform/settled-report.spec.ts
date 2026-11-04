import { describe, expect, it } from 'vitest'

import type { SettledState } from '@workspace/ui-contract/anchors'

import {
  type PageAnimation,
  reportSettled,
  type SettlingPage,
  settledValueOf,
} from './settled-report'

/** An animation that runs until the test ends it, `endTime` long (`Infinity`: endless). */
function animation(endTime: number) {
  let end = (): void => {}
  let state: AnimationPlayState = 'running'
  const finished = new Promise<unknown>((resolve) => {
    end = () => resolve(undefined)
  })
  const running: PageAnimation = {
    get playState() {
      return state
    },
    effect: { getComputedTiming: () => ({ endTime }) },
    finished,
  }

  return {
    running,
    end: () => {
      state = 'finished'
      end()
    },
  }
}

/** A page whose frames the test paints, with `animations` running and the binding it exposes. */
function fakePage(animations: PageAnimation[] = [], bound = true) {
  const frames: (() => void)[] = []
  const reports: SettledState[] = []
  const page: SettlingPage = {
    frame: (callback) => {
      frames.push(callback)
    },
    animations: () => animations,
    read: () => ({ url: 'https://perch.test/sign-in', anchors: [] }),
    report: bound
      ? (state) => {
          reports.push(state)
        }
      : undefined,
  }

  /** Paints every frame asked for until none is, then lets the promises run. */
  const paint = async () => {
    for (let frame = frames.shift(); frame !== undefined; frame = frames.shift()) {
      frame()
      await Promise.resolve()
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { page, reports, paint }
}

const SETTLING = { screen: 'user.sign-in', value: 'sign-up', stays: () => true }

describe('settledValueOf', () => {
  it('keeps a state of the root as it is, and leaves out a region that is in no state', () => {
    expect(settledValueOf('sign-in')).toBe('sign-in')
    expect(
      settledValueOf({ viewing: { form: 'open', notes: undefined, list: { item: 'idle' } } }),
    ).toEqual({ viewing: { form: 'open', list: { item: 'idle' } } })
  })
})

describe('reportSettled', () => {
  it('reports the screen, the state and the page once the page has painted it', async () => {
    const { page, reports, paint } = fakePage()

    reportSettled(page, SETTLING)
    expect(reports).toEqual([])
    await paint()

    expect(reports).toEqual([
      {
        screen: 'user.sign-in',
        value: 'sign-up',
        page: { url: 'https://perch.test/sign-in', anchors: [] },
      },
    ])
  })

  it('waits for every animation that ends, and not for an endless one', async () => {
    const opening = animation(200)
    const spinner = animation(Infinity)
    const { page, reports, paint } = fakePage([opening.running, spinner.running])

    reportSettled(page, SETTLING)
    await paint()
    expect(reports).toEqual([])

    opening.end()
    await paint()

    expect(reports.map(({ value }) => value)).toEqual(['sign-up'])
  })

  it('reports nothing once the machine has left the state, or the stop ran first', async () => {
    const { page, reports, paint } = fakePage()

    reportSettled(page, { ...SETTLING, stays: () => false })
    reportSettled(page, SETTLING)()
    await paint()

    expect(reports).toEqual([])
  })

  it('asks for no frame without the binding', async () => {
    const { page, paint } = fakePage([], false)
    let asked = false

    reportSettled(
      {
        ...page,
        frame: () => {
          asked = true
        },
      },
      SETTLING,
    )
    await paint()

    expect(asked).toBe(false)
  })
})
