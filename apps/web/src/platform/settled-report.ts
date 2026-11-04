/**
 * The report of a settled state, in development and e2e builds: once the page shows a state of a
 * screen's machine (React committed it, the browser painted it, and every animation of the page
 * that ends has ended), the screen, the state value and the page as the helper reads it then go
 * to the binding an e2e run exposes (`window.__perchSettledState`), which holds the page to what
 * the state renders. A state the machine leaves before then is not settled and goes unreported,
 * and without the binding nothing is read.
 */

import { useEffect, useRef } from 'react'
import type { StateValue } from 'xstate'

import {
  type RenderedPage,
  SETTLED_STATE,
  type SettledState,
  type SettledValue,
} from '@workspace/ui-contract/anchors'

import { renderedAnchors } from './ui-contract'

/** XState's state value as a report carries it: a region that is in no state is left out. */
export function settledValueOf(value: StateValue): SettledValue {
  if (typeof value === 'string') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, of]) =>
      of === undefined ? [] : [[name, settledValueOf(of)]],
    ),
  )
}

/** What a report reads of an animation of the page. */
export interface PageAnimation {
  readonly playState: AnimationPlayState
  readonly effect: { getComputedTiming(): { readonly endTime?: CSSNumberish } } | null
  readonly finished: Promise<unknown>
}

/** The page a report reads, as the browser's window gives it (`pageOf`). */
export interface SettlingPage {
  /** Runs `callback` before the browser paints the next frame. */
  readonly frame: (callback: () => void) => void
  readonly animations: () => readonly PageAnimation[]
  readonly read: () => RenderedPage
  /** The binding an e2e run exposes, when it does. */
  readonly report: ((state: SettledState) => unknown) | undefined
}

/** The page of `window`. */
export const pageOf = (window: Window): SettlingPage => ({
  frame: (callback) => window.requestAnimationFrame(() => callback()),
  animations: () => window.document.getAnimations(),
  read: () => renderedAnchors(window.document, window.location),
  report: window[SETTLED_STATE],
})

/** Resolves once the browser has painted what React committed: after the next frame's. */
const painted = (page: SettlingPage): Promise<void> =>
  new Promise((resolve) => {
    page.frame(() => page.frame(() => resolve()))
  })

/** The animations of the page that end and still run; an endless one (a spinner) never settles. */
const running = (page: SettlingPage): PageAnimation[] =>
  page
    .animations()
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        animation.effect?.getComputedTiming().endTime !== Infinity,
    )

/** Resolves once no animation that ends runs, one that another started included. */
async function animationsEnded(page: SettlingPage): Promise<void> {
  for (let now = running(page); now.length > 0; now = running(page)) {
    // A cancelled animation rejects its `finished`: it has ended all the same.
    await Promise.all(now.map((animation) => animation.finished.catch(() => undefined)))
  }
}

/** What a report needs: the screen, the state value it shows, and whether the machine stays in it. */
export interface Settling {
  readonly screen: string
  readonly value: SettledValue
  /** Whether the machine is still in `value`, read once the page has settled. */
  readonly stays: () => boolean
}

/**
 * Reports `settling` to the binding of `page` once the page has settled, unless the machine has
 * left the state by then or the returned stop ran first; does nothing without the binding.
 */
export function reportSettled(page: SettlingPage, settling: Settling): () => void {
  const { report } = page
  let stopped = false

  if (report !== undefined) {
    void painted(page)
      .then(() => animationsEnded(page))
      .then(() => {
        if (!stopped && settling.stays()) {
          const state = { screen: settling.screen, value: settling.value, page: page.read() }

          // A page that moves on while the run takes the report drops its answer, which says nothing.
          void Promise.resolve(report(state)).catch(() => undefined)
        }
      })
  }

  return () => {
    stopped = true
  }
}

/**
 * In development and e2e builds (those with the page helper), reports each state of `screen`'s machine the page settles in:
 * `value` is the state the page renders now, `current` reads the machine's state when it settles.
 */
export function useSettledReport(
  screen: string,
  value: StateValue,
  current: () => StateValue,
): void {
  const settled = settledValueOf(value)
  // A new object on every render: the state it names is what starts a report, and the effect
  // reads the value and the machine of the render that committed it.
  const key = JSON.stringify(settled)
  const latest = useRef({ settled, current })

  latest.current = { settled, current }

  useEffect(() => {
    // Only the builds that install the page helper report: development and e2e ones (main.tsx).
    if (window.__perch?.ui === undefined) {
      return undefined
    }

    const { settled: shown, current: read } = latest.current

    return reportSettled(pageOf(window), {
      screen,
      value: shown,
      stays: () => JSON.stringify(settledValueOf(read())) === key,
    })
  }, [screen, key])
}
