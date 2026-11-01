/**
 * The page helper of development and e2e builds: `window.__perch.ui.anchors()` lists the
 * anchors the page renders now (every `data-testid`, in document order) with the attributes a
 * test or an agent reads, so what exists on a page is visible without reading code.
 */

import {
  ANCHOR_ATTRIBUTES,
  kindOf,
  type RenderedAnchor,
  type RenderedPage,
} from '@workspace/ui-contract/anchors'

export type { RenderedAnchor, RenderedPage }

/** Hidden by the `hidden` attribute, `display: none` or `visibility: hidden` up the tree. */
function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView

  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const style = view?.getComputedStyle(at)

    if (at.hasAttribute('hidden') || style?.display === 'none') {
      return false
    }

    if (at === element && style?.visibility === 'hidden') {
      return false
    }
  }

  return true
}

function renderedAnchor(element: Element, anchor: string): RenderedAnchor {
  const state = element.getAttribute(ANCHOR_ATTRIBUTES.state)
  const code = element.getAttribute(ANCHOR_ATTRIBUTES.code)
  const dataId = element.getAttribute(ANCHOR_ATTRIBUTES.id)
  const dataValue = element.getAttribute(ANCHOR_ATTRIBUTES.value)

  return {
    anchor,
    kind: kindOf(anchor),
    ...(state === null ? {} : { state }),
    ...(code === null ? {} : { code }),
    ...(dataId === null ? {} : { dataId }),
    ...(dataValue === null ? {} : { dataValue }),
    visible: isVisible(element),
  }
}

export function renderedAnchors(
  document: Document,
  location: Pick<Location, 'href'>,
): RenderedPage {
  const elements = document.querySelectorAll(`[${ANCHOR_ATTRIBUTES.anchor}]`)

  return {
    url: location.href,
    anchors: Array.from(elements, (element) =>
      renderedAnchor(element, element.getAttribute(ANCHOR_ATTRIBUTES.anchor) ?? ''),
    ),
  }
}

/** Installs `window.__perch.ui`; each call of `anchors()` reads the page as it is then. */
export function installUiHelper(window: Window): void {
  window.__perch = {
    ...window.__perch,
    ui: { anchors: () => renderedAnchors(window.document, window.location) },
  }
}
