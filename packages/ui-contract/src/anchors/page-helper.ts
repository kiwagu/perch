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

declare global {
  interface Window {
    /** Installed by development and e2e builds only. */
    __perch?: PerchPageHelper
  }
}
