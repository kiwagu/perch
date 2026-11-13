/**
 * Whether an element appeared on a page while the test did something, for an expected result
 * that says "without … having been shown": a look after the move sees only that the element is
 * gone by then, not that it never came.
 */

import type { Page } from '@playwright/test'

/**
 * Watches `page` from now on for an element `selector` matches: one there now, one added, or one
 * an attribute change makes match, though it is gone again by the next look. The function it
 * gives ends the watch and tells whether one appeared; it fails when the page loaded anew in the
 * meantime, which ends the watch with the document it watched.
 */
export async function watchShown(page: Page, selector: string): Promise<() => Promise<boolean>> {
  const watch = await page.evaluateHandle((watched: string) => {
    const holds = (node: Node): boolean =>
      node instanceof Element && (node.matches(watched) || node.querySelector(watched) !== null)
    const state = { shown: document.querySelector(watched) !== null, stop: () => {} }
    const observer = new MutationObserver((records) => {
      state.shown ||= records.some(
        (record) => holds(record.target) || Array.from(record.addedNodes).some(holds),
      )
    })

    observer.observe(document, { subtree: true, childList: true, attributes: true })
    state.stop = () => observer.disconnect()

    return state
  }, selector)

  return async () => {
    const shown = await watch.evaluate((state) => {
      state.stop()

      return state.shown
    })

    await watch.dispose()

    return shown
  }
}
