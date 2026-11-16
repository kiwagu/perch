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
    'x.y.email-input': { screen: 'x.y', kind: 'input' },
    'x.y.forgot-link': { screen: 'x.y', kind: 'link' },
    'x.y.name-input': {
      screen: 'x.y',
      kind: 'input',
      derived: ['visibility-button', 'error-message'],
    },
    'x.y.leave-dialog': {
      screen: 'x.y',
      kind: 'dialog',
      derived: ['confirm-button', 'cancel-button'],
    },
    'x.y.mode-select': { screen: 'x.y', kind: 'select', derived: ['option', 'toggle-button'] },
    'x.y.rule-list': { screen: 'x.y', kind: 'list' },
    'x.y.rule-list.length-item': { screen: 'x.y', kind: 'item' },
    'x.y.form': { screen: 'x.y', kind: 'form', roles: ['member'] },
    'x.y.form.key-input': { screen: 'x.y', kind: 'input' },
    'x.y.item': { screen: 'x.y', kind: 'item', dataId: 'note' },
    'x.y.item.edit-textarea': { screen: 'x.y', kind: 'textarea' },
    'x.y.edit-textarea': { screen: 'x.y', kind: 'textarea', own: true },
    'app-shell.nav': { screen: 'app-shell', kind: 'nav', roles: ['identity'] },
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
          kind: 'list',
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

/** A flow whose busy state alone renders `x.y.later-button`. */
const SHOWING = {
  initial: 'idle',
  states: { idle: {}, busy: { meta: { renders: ['x.y.later-button'] } } },
}

/** The problems of a page of `x.y` in `value`, its anchors declared as `ids`. */
const onPage = (ids: SettledContract['ids'], anchors: RenderedAnchor[], value = 'idle') =>
  settledProblems({ screens: [{ id: 'x.y', flow: SHOWING }], ids }, settled(value, anchors))

/** A visible element that carries `code`, as a report with codes reads it. */
const coded = (anchor: string, code: string): RenderedAnchor => ({ ...shown(anchor), code })

describe('a settled state held to what its elements show with and without', () => {
  const update: SettledContract['ids'] = {
    'x.y.update-message': { screen: 'x.y', kind: 'message' },
    'x.y.update-button': { screen: 'x.y', kind: 'button', with: ['x.y.update-message'] },
  }
  const install: SettledContract['ids'] = {
    'x.y.install-message': { screen: 'x.y', kind: 'message' },
    'x.y.install-button': {
      screen: 'x.y',
      kind: 'button',
      with: [{ 'x.y.install-message': ['install-available'] }],
    },
  }

  it('holds a control to show exactly while what it shows with shows', () => {
    expect(onPage(update, [shown('x.y.update-button')])).toEqual([
      'x.y in idle: "x.y.update-button" is visible, but "x.y.update-message" does not show: it shows only with it',
    ])
    expect(onPage(update, [shown('x.y.update-message'), hidden('x.y.update-button')])).toEqual([
      'x.y in idle: "x.y.update-button" is not visible, but each entry of its with shows and none of its without',
    ])
    expect(onPage(update, [shown('x.y.update-message'), shown('x.y.update-button')])).toEqual([])
    expect(onPage(update, [hidden('x.y.update-message'), hidden('x.y.update-button')])).toEqual([])
  })

  it('holds a code entry to the code the anchor shows, as a report with codes reads it', () => {
    expect(
      onPage(install, [
        coded('x.y.install-message', 'install-by-steps'),
        shown('x.y.install-button'),
      ]),
    ).toEqual([
      'x.y in idle: "x.y.install-button" is visible, but "x.y.install-message" (install-available) does not show: it shows only with it',
    ])
    expect(onPage(install, [coded('x.y.install-message', 'install-available')])).toEqual([
      'x.y in idle: "x.y.install-button" is not visible, but each entry of its with shows and none of its without',
    ])
    expect(
      onPage(install, [
        coded('x.y.install-message', 'install-available'),
        shown('x.y.install-button'),
      ]),
    ).toEqual([])
    expect(onPage(install, [coded('x.y.install-message', 'install-by-steps')])).toEqual([])
  })

  it('skips the code of a code entry on a report without codes, and still holds its anchor', () => {
    expect(onPage(install, [shown('x.y.install-message'), shown('x.y.install-button')])).toEqual([])
    expect(onPage(install, [shown('x.y.install-message')])).toEqual([])
    expect(onPage(install, [shown('x.y.install-button')])).toEqual([
      'x.y in idle: "x.y.install-button" is visible, but "x.y.install-message" (install-available) does not show: it shows only with it',
    ])
  })

  it('holds an element with only without entries to hiding while one shows, never to showing', () => {
    const ids: SettledContract['ids'] = {
      'x.y.banned-badge': { screen: 'x.y', kind: 'badge' },
      'x.y.ban-button': { screen: 'x.y', kind: 'button', without: ['x.y.banned-badge'] },
    }

    expect(onPage(ids, [shown('x.y.banned-badge'), shown('x.y.ban-button')])).toEqual([
      'x.y in idle: "x.y.ban-button" is visible, but "x.y.banned-badge" shows: it shows only without it',
    ])
    // Nothing on the page says the area that holds it shows: an account still read shows neither.
    expect(onPage(ids, [])).toEqual([])
    expect(onPage(ids, [shown('x.y.ban-button')])).toEqual([])
  })

  it('lets a cell, an element data decides and one the state does not render stay away', () => {
    const ids: SettledContract['ids'] = {
      'x.y.heading': { screen: 'x.y', kind: 'heading' },
      'x.y.banned-badge': { screen: 'x.y', kind: 'badge' },
      'x.y.reason-cell': { screen: 'x.y', kind: 'cell', with: ['x.y.banned-badge'] },
      'x.y.toggle-button': {
        screen: 'x.y',
        kind: 'button',
        roles: ['member'],
        with: ['x.y.heading'],
      },
      'x.y.later-button': { screen: 'x.y', kind: 'button', with: ['x.y.heading'] },
      'x.y.status': { screen: 'x.y', kind: 'status', with: ['x.y.heading'] },
    }

    expect(onPage(ids, [shown('x.y.heading'), shown('x.y.banned-badge')])).toEqual([])
    expect(onPage(ids, [shown('x.y.reason-cell'), shown('x.y.toggle-button')])).toEqual([
      'x.y in idle: "x.y.reason-cell" is visible, but "x.y.banned-badge" does not show: it shows only with it',
      'x.y in idle: "x.y.toggle-button" is visible, but "x.y.heading" does not show: it shows only with it',
    ])
  })

  it('leaves an element of an entry to the entry, which the report does not tell apart', () => {
    const ids: SettledContract['ids'] = {
      'x.y.devices.list': { screen: 'x.y', kind: 'list' },
      'x.y.devices.entry-item': { screen: 'x.y', kind: 'item', dataId: 'device' },
      'x.y.devices.current-badge': { screen: 'x.y', kind: 'badge' },
      'x.y.devices.end-button': {
        screen: 'x.y',
        kind: 'button',
        without: ['x.y.devices.current-badge'],
      },
    }

    expect(
      onPage(ids, [
        shown('x.y.devices.list'),
        shown('x.y.devices.entry-item'),
        shown('x.y.devices.current-badge'),
        shown('x.y.devices.entry-item'),
        shown('x.y.devices.end-button'),
      ]),
    ).toEqual([])
  })

  it('refuses a visible list with no entry, unless it shows itself waiting or empty', () => {
    const ids: SettledContract['ids'] = {
      'x.y.notes.list': { screen: 'x.y', kind: 'list' },
      'x.y.notes.item': { screen: 'x.y', kind: 'item', dataId: 'note' },
      'x.y.users.list': { screen: 'x.y', kind: 'list', states: ['loading', 'ready', 'empty'] },
      'x.y.users.account-item': { screen: 'x.y', kind: 'item', dataId: 'account' },
      'x.y.sent.list': { screen: 'x.y', kind: 'list', states: ['loading'] },
      'x.y.sent.item': { screen: 'x.y', kind: 'item', dataId: 'invitation' },
    }
    const empty =
      'x.y in idle: "x.y.notes.list" is visible with no entry: a list with none is not rendered'

    expect(onPage(ids, [shown('x.y.notes.list')])).toEqual([empty])
    expect(onPage(ids, [shown('x.y.notes.list'), hidden('x.y.notes.item')])).toEqual([empty])
    expect(onPage(ids, [shown('x.y.notes.list'), shown('x.y.notes.item')])).toEqual([])
    expect(onPage(ids, [hidden('x.y.notes.list')])).toEqual([])
    expect(onPage(ids, [shown('x.y.users.list'), shown('x.y.sent.list')])).toEqual([])
  })
})
