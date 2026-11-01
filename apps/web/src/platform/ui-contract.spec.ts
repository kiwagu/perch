// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { installUiHelper, renderedAnchors } from './ui-contract'

afterEach(() => {
  document.body.innerHTML = ''
  delete window.__perch
})

describe('renderedAnchors', () => {
  it('lists the anchors of the page in document order, with their attributes and visibility', () => {
    document.body.innerHTML = `
      <span data-testid="app-shell.status" data-state="ready"></span>
      <div hidden><button data-testid="x.y.z-button" data-code="saved">Save</button></div>
      <ul><li data-testid="x.y.row-item" data-id="nte_1" data-value="small">One</li></ul>
      <p>no anchor</p>`

    expect(renderedAnchors(document, new URL('https://localhost/sign-in?next=%2Fme'))).toEqual({
      url: 'https://localhost/sign-in?next=%2Fme',
      anchors: [
        { anchor: 'app-shell.status', kind: 'status', state: 'ready', visible: true },
        { anchor: 'x.y.z-button', kind: 'button', code: 'saved', visible: false },
        {
          anchor: 'x.y.row-item',
          kind: 'item',
          dataId: 'nte_1',
          dataValue: 'small',
          visible: true,
        },
      ],
    })
  })
  it('sees an element hidden by its style as not visible', () => {
    document.body.innerHTML = `
      <section style="display: none"><span data-testid="x.y.cell"></span></section>
      <span data-testid="x.z.badge" style="visibility: hidden"></span>`

    expect(
      renderedAnchors(document, window.location).anchors.map(({ visible }) => visible),
    ).toEqual([false, false])
  })
})

describe('installUiHelper', () => {
  it('puts the helper on window.__perch.ui, reading the page at each call', () => {
    installUiHelper(window)
    document.body.innerHTML = '<span data-testid="app-shell.status" data-state="opening"></span>'

    expect(window.__perch?.ui.anchors()).toEqual({
      url: window.location.href,
      anchors: [{ anchor: 'app-shell.status', kind: 'status', state: 'opening', visible: true }],
    })
  })
})
