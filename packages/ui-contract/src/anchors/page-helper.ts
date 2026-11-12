/**
 * The page helper development and e2e builds install on `window`: `__perch.ui.anchors()`
 * lists the anchors the page renders now, with the attributes a test or an agent reads.
 */

/** Where the helper sits on `window`, as the manifest names it. */
export const PAGE_HELPER = '__perch.ui'

/** The attributes an anchor carries, by what they hold. */
export const ANCHOR_ATTRIBUTES = {
  anchor: 'data-testid',
  state: 'data-state',
  code: 'data-code',
  id: 'data-id',
  value: 'data-value',
} as const

/** One element of the page that carries an anchor. */
export interface RenderedAnchor {
  /** The value of `data-testid`. */
  anchor: string
  /** The kind, the last dash-separated word of the anchor's last segment. */
  kind: string
  state?: string
  code?: string
  dataId?: string
  dataValue?: string
  /** False when the element or one of its ancestors is hidden. */
  visible: boolean
}

/** What `__perch.ui.anchors()` returns: the page's URL and its anchors in document order. */
export interface RenderedPage {
  url: string
  anchors: RenderedAnchor[]
}

export interface PerchPageHelper {
  ui: { anchors: () => RenderedPage }
}

/**
 * The binding an e2e run exposes on `window` (Playwright's `exposeBinding`): a development or
 * e2e build reports to it each settled state of a screen's machine, once the page has rendered
 * that state, and the harness holds what the page shows to what the state renders.
 */
export const SETTLED_STATE = '__perchSettledState'

/** XState's state value: a state of the root, or a parallel state and each region's state. */
export type SettledValue = string | { readonly [state: string]: SettledValue }

/** One settled state of a screen's machine, with the page as the helper reads it then. */
export interface SettledState {
  /** The id of the screen whose flow the machine runs, `app-shell` for the frame. */
  screen: string
  value: SettledValue
  page: RenderedPage
}

declare global {
  interface Window {
    /** Installed by development and e2e builds only. */
    __perch?: PerchPageHelper
    /** Exposed by an e2e run only, as `SETTLED_STATE` names it. */
    __perchSettledState?: (state: SettledState) => unknown
  }
}
