import { describe, expect, it } from 'vitest'

import type { RenderedAnchor, SettledState } from '../anchors'

import { buildManifest } from './build'
import { fixtureContract } from './manifest.fixture'
import { type SettledContract, settledProblems } from './settled'

const FLOW = {
  initial: 'sign-in',
  states: {
    'sign-in': { meta: { renders: ['x.y.forgot-link'] } },
    'sign-up': { meta: { renders: ['x.y.name-input', 'x.y.rule-list'] } },
    listing: { meta: { renders: ['x.y.item'] } },
    confirming: { meta: { renders: ['x.y.leave-dialog', 'x.y.mode-select'] } },
    viewing: {
      type: 'parallel',
      states: {
        form: {
          initial: 'closed',
          states: { closed: {}, open: { meta: { renders: ['x.y.form'] } } },
        },
        notes: {
          initial: 'idle',
          states: { idle: {}, editing: { meta: { renders: ['x.y.edit-textarea'] } } },
        },
      },
    },
  },
}

const CONTRACT: SettledContract = {
  screens: [
    { id: 'x.y', flow: FLOW },
    {
      id: 'app-shell',
      flow: {
        initial: 'ready',
        states: { ready: { meta: { renders: ['app-shell.nav'] } }, out: {} },
      },
    },
  ],
  ids: {
    'x.y.email-input': { screen: 'x.y' },
    'x.y.forgot-link': { screen: 'x.y' },
    'x.y.name-input': { screen: 'x.y', derived: ['visibility-button', 'error-message'] },
    'x.y.leave-dialog': { screen: 'x.y', derived: ['confirm-button', 'cancel-button'] },
    'x.y.mode-select': { screen: 'x.y', derived: ['option', 'toggle-button'] },
    'x.y.rule-list': { screen: 'x.y' },
    'x.y.rule-list.length-item': { screen: 'x.y' },
    'x.y.form': { screen: 'x.y', roles: ['member'] },
    'x.y.form.key-input': { screen: 'x.y' },
    'x.y.item': { screen: 'x.y', dataId: 'note' },
    'x.y.item.edit-textarea': { screen: 'x.y' },
    'x.y.edit-textarea': { screen: 'x.y', own: true },
    'app-shell.nav': { screen: 'app-shell', roles: ['identity'] },
  },
}

const shown = (anchor: string): RenderedAnchor => ({ anchor, kind: 'x', visible: true })
const hidden = (anchor: string): RenderedAnchor => ({ anchor, kind: 'x', visible: false })

const settled = (value: SettledState['value'], anchors: RenderedAnchor[]): SettledState => ({
  screen: 'x.y',
  value,
  page: { url: 'https://stand.example.test/sign-in', anchors },
})

/** The page of the sign-in mode: every anchor that state renders, on the page and visible. */
const SIGN_IN = [shown('x.y.email-input'), shown('x.y.forgot-link')]
const SIGN_UP = [
  shown('x.y.email-input'),
  shown('x.y.name-input'),
  shown('x.y.name-input.visibility-button'),
  shown('x.y.rule-list'),
  shown('x.y.rule-list.length-item'),
]

describe('a settled state held to what it renders', () => {
  it('passes a page that shows what the state renders and hides the rest', () => {
    expect(settledProblems(CONTRACT, settled('sign-in', SIGN_IN))).toEqual([])
    expect(settledProblems(CONTRACT, settled('sign-up', SIGN_UP))).toEqual([])
    expect(
      settledProblems(CONTRACT, settled('sign-up', [...SIGN_UP, hidden('x.y.forgot-link')])),
    ).toEqual([])
  })

  it('refuses an anchor visible in a state that does not render it, once per anchor', () => {
    expect(
      settledProblems(
        CONTRACT,
        settled('sign-up', [...SIGN_UP, shown('x.y.forgot-link'), shown('x.y.forgot-link')]),
      ),
    ).toEqual(['x.y in sign-up: "x.y.forgot-link" is visible, but the state does not render it'])
  })

  it('refuses a listed anchor the state renders when it is not on the page, or hidden', () => {
    expect(
      settledProblems(
        CONTRACT,
        settled('sign-up', [shown('x.y.email-input'), hidden('x.y.name-input')]),
      ),
    ).toEqual([
      'x.y in sign-up: "x.y.name-input" is hidden, but the state renders it',
      'x.y in sign-up: "x.y.name-input.visibility-button" is not on the page, but the state renders it',
      'x.y in sign-up: "x.y.rule-list" is not on the page, but the state renders it',
      'x.y in sign-up: "x.y.rule-list.length-item" is not on the page, but the state renders it',
    ])
  })

  it('holds a part derived from a listed anchor with it, and leaves the base set alone', () => {
    expect(
      settledProblems(
        CONTRACT,
        settled('sign-in', [...SIGN_IN, shown('x.y.name-input.visibility-button')]),
      ),
    ).toEqual([
      'x.y in sign-in: "x.y.name-input.visibility-button" is visible, but the state does not render it',
    ])
    expect(settledProblems(CONTRACT, settled('sign-in', [shown('x.y.forgot-link')]))).toEqual([])
  })

  it("holds a rendered anchor's derived parts with it, save those a page shows on demand", () => {
    expect(
      settledProblems(
        CONTRACT,
        settled('confirming', [
          shown('x.y.email-input'),
          shown('x.y.leave-dialog'),
          shown('x.y.leave-dialog.confirm-button'),
          hidden('x.y.leave-dialog.cancel-button'),
          shown('x.y.mode-select'),
        ]),
      ),
    ).toEqual([
      'x.y in confirming: "x.y.leave-dialog.cancel-button" is hidden, but the state renders it',
      'x.y in confirming: "x.y.mode-select.toggle-button" is not on the page, but the state renders it',
    ])
    expect(
      settledProblems(
        CONTRACT,
        settled('confirming', [
          shown('x.y.leave-dialog'),
          shown('x.y.leave-dialog.confirm-button'),
          shown('x.y.leave-dialog.cancel-button'),
          shown('x.y.mode-select'),
          shown('x.y.mode-select.toggle-button'),
        ]),
      ),
    ).toEqual([])
  })

  it('holds the size select of a paged list with it, and leaves its range and links to the data', () => {
    const contract: SettledContract = {
      screens: [
        {
          id: 'x.y',
          flow: {
            initial: 'listing',
            states: { listing: { meta: { renders: ['x.y.page-list'] } }, idle: {} },
          },
        },
      ],
      ids: {
        'x.y.page-list': {
          screen: 'x.y',
          derived: ['range', 'previous-link', 'next-link', 'size-select'],
        },
      },
    }

    expect(settledProblems(contract, settled('listing', [shown('x.y.page-list')]))).toEqual([
      'x.y in listing: "x.y.page-list.size-select" is not on the page, but the state renders it',
    ])
    expect(
      settledProblems(
        contract,
        settled('listing', [shown('x.y.page-list'), shown('x.y.page-list.size-select')]),
      ),
    ).toEqual([])
    expect(
      settledProblems(
        contract,
        settled('idle', [shown('x.y.page-list.next-link'), shown('x.y.page-list.range')]),
      ),
    ).toEqual([
      'x.y in idle: "x.y.page-list.next-link" is visible, but the state does not render it',
      'x.y in idle: "x.y.page-list.range" is visible, but the state does not render it',
    ])
  })

  it('lets data decide whether a rendered anchor with roles or own, an entry or what is under them shows', () => {
    const open = { viewing: { form: 'open', notes: 'editing' } }

    expect(settledProblems(CONTRACT, settled(open, [shown('x.y.email-input')]))).toEqual([])
    expect(settledProblems(CONTRACT, settled('listing', [shown('x.y.email-input')]))).toEqual([])
    expect(
      settledProblems(CONTRACT, settled('sign-in', [...SIGN_IN, shown('x.y.item.edit-textarea')])),
    ).toEqual([
      'x.y in sign-in: "x.y.item.edit-textarea" is visible, but the state does not render it',
    ])
    expect(
      settledProblems(
        CONTRACT,
        settled({ viewing: { form: 'closed', notes: 'idle' } }, [
          shown('x.y.form'),
          shown('x.y.form.key-input'),
          shown('x.y.edit-textarea'),
        ]),
      ),
    ).toEqual([
      'x.y in viewing (form: closed, notes: idle): "x.y.form" is visible, but the state does not render it',
      'x.y in viewing (form: closed, notes: idle): "x.y.form.key-input" is visible, but the state does not render it',
      'x.y in viewing (form: closed, notes: idle): "x.y.edit-textarea" is visible, but the state does not render it',
    ])
  })

  it("judges only the anchors of the reported screen's flow", () => {
    expect(
      settledProblems(CONTRACT, settled('sign-in', [...SIGN_IN, shown('app-shell.nav')])),
    ).toEqual([])
    expect(
      settledProblems(CONTRACT, {
        screen: 'app-shell',
        value: 'out',
        page: { url: 'https://stand.example.test/', anchors: [shown('app-shell.nav')] },
      }),
    ).toEqual(['app-shell in out: "app-shell.nav" is visible, but the state does not render it'])
  })

  it('names a screen the contract does not have', () => {
    expect(settledProblems(CONTRACT, { ...settled('sign-in', SIGN_IN), screen: 'x.z' })).toEqual([
      '"x.z" is no screen of the contract',
    ])
  })

  it('reads the manifest a stand serves, whose flow that lists nothing holds nothing', () => {
    const manifest = buildManifest({
      ...fixtureContract(),
      product: { name: 'perch', version: '0.0.0', commit: null },
      now: new Date('2026-11-04T12:00:00.000Z'),
    })
    const anchors = Object.keys(manifest.ids).map((anchor, index) =>
      index % 2 === 0 ? shown(anchor) : hidden(anchor),
    )

    expect(
      settledProblems(manifest, {
        screen: 'sample',
        value: 'editing',
        page: { url: 'https://stand.example.test/sample/thg_01hzx9k2', anchors },
      }),
    ).toEqual([])
  })
})
