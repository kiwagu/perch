import { describe, expect, it } from 'vitest'

import { type AnchorDef, formatProblem } from '../files'

import type { Contract } from './contract'
import { sampleContract, screenIn } from './contract.fixture'
import { withProblems } from './with'

const FILE = 'contract/domain/screens/board.yaml'

/**
 * The sample contract with a screen whose elements say when they show: the page's status while
 * no heading is, a notice's buttons with it (one only while it shows a code), the ban's buttons
 * by the account's mark, and the end button of each entry by the marks of the same entry.
 */
function board(): Contract {
  const contract = sampleContract()
  const anchors: Record<string, AnchorDef> = {
    'board.page.heading': { kind: 'heading' },
    'board.page.status': {
      kind: 'status',
      roles: ['member'],
      states: ['empty'],
      without: ['board.page.heading'],
    },
    'board.notice.message': { kind: 'message', codes: ['saved', 'failed'] },
    'board.notice.retry-button': { kind: 'button', with: ['board.notice.message'] },
    'board.notice.save-button': {
      kind: 'button',
      with: [{ 'board.notice.message': ['saved'] }],
      without: ['board.page.status'],
    },
    'board.marks.banned-badge': { kind: 'badge' },
    'board.marks.reason-cell': { kind: 'cell', with: ['board.marks.banned-badge'] },
    'board.ban.ban-button': { kind: 'button', without: ['board.marks.banned-badge'] },
    'board.ban.unban-button': { kind: 'button', with: ['board.marks.banned-badge'] },
    'board.list': { kind: 'list', source: { platform: 'devices.list' } },
    'board.list.entry-item': { kind: 'item', dataId: 'device_session' },
    'board.list.current-badge': { kind: 'badge' },
    'board.list.ended-cell': { kind: 'cell' },
    'board.list.end-button': {
      kind: 'button',
      without: ['board.list.current-badge', 'board.list.ended-cell'],
    },
  }

  contract.screens.screens.push({
    id: 'board',
    title: 'Board',
    description: 'Where elements say when they show.',
    bindings: [{ path: '/board', roles: ['member'], history: 'push' }],
    flag: null,
    entry: ['board.page.heading'],
    anchors,
  })
  contract.screens.files = [...contract.screens.files, FILE]

  return contract
}

/** The anchor `anchor` of the board screen, for a spec to change. */
function anchorOf(contract: Contract, anchor: string): AnchorDef {
  const def = screenIn(contract, 'board').anchors[anchor]

  if (def === undefined) {
    throw new Error(`no anchor ${anchor}`)
  }

  return def
}

const printed = (contract: Contract): string[] => withProblems(contract).map(formatProblem)

const at = (anchor: string, path: string): string => `${FILE}:1: anchors["${anchor}"].${path}`

describe('withProblems', () => {
  it('finds nothing in entries of the same screen, a code entry among its codes, an entry by its own', () => {
    expect(printed(board())).toEqual([])
    expect(printed(sampleContract())).toEqual([])
  })

  it('refuses an anchor that names itself', () => {
    const contract = board()

    anchorOf(contract, 'board.ban.unban-button').with = ['board.ban.unban-button']

    expect(printed(contract)).toEqual([
      `${at('board.ban.unban-button', 'with[0]')}: "board.ban.unban-button" names itself`,
    ])
  })

  it('refuses an anchor of another screen, the frame included, and one no screen declares', () => {
    const contract = board()

    anchorOf(contract, 'board.ban.unban-button').with = ['sample.a-button']
    anchorOf(contract, 'board.ban.ban-button').without = ['app-shell.status']
    anchorOf(contract, 'board.marks.reason-cell').with = ['board.marks.gone-badge']
    screenIn(contract, 'app-shell').anchors['app-shell.status'] = {
      kind: 'status',
      states: ['opening', 'ready'],
      with: ['board.page.heading'],
    }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/__root.yaml:1: anchors["app-shell.status"].with[0]: "board.page.heading" is an anchor of board: an entry names an anchor of app-shell',
      `${at('board.marks.reason-cell', 'with[0]')}: "board.marks.gone-badge" is no anchor of board`,
      `${at('board.ban.ban-button', 'without[0]')}: "app-shell.status" is an anchor of app-shell: an entry names an anchor of board`,
      `${at('board.ban.unban-button', 'with[0]')}: "sample.a-button" is an anchor of sample: an entry names an anchor of board`,
    ])
  })

  it('refuses a code the named anchor never carries, one that carries none included', () => {
    const contract = board()

    anchorOf(contract, 'board.notice.save-button').with = [
      { 'board.notice.message': ['saved', 'gone'] },
    ]
    anchorOf(contract, 'board.ban.unban-button').with = [{ 'board.marks.banned-badge': ['saved'] }]

    expect(printed(contract)).toEqual([
      `${at('board.notice.save-button', 'with[0]')}: "board.notice.message" carries no code "gone"`,
      `${at('board.ban.unban-button', 'with[0]')}: "board.marks.banned-badge" carries no code "saved"`,
    ])
  })

  it('refuses an anchor in both lists, or twice in one', () => {
    const contract = board()

    anchorOf(contract, 'board.ban.unban-button').without = ['board.marks.banned-badge']
    anchorOf(contract, 'board.notice.retry-button').with = [
      'board.notice.message',
      { 'board.notice.message': ['failed'] },
    ]

    expect(printed(contract)).toEqual([
      `${at('board.notice.retry-button', 'with[1]')}: "board.notice.message" is named twice`,
      `${at('board.ban.unban-button', 'without[0]')}: "board.marks.banned-badge" is in both with and without`,
    ])
  })

  it('refuses a cycle, of two anchors or through another one, on every anchor it passes', () => {
    const contract = board()

    anchorOf(contract, 'board.page.heading').without = ['board.page.status']
    anchorOf(contract, 'board.marks.banned-badge').with = ['board.notice.retry-button']
    anchorOf(contract, 'board.notice.message').with = ['board.ban.unban-button']

    expect(printed(contract)).toEqual([
      `${at('board.page.heading', 'without[0]')}: "board.page.status" names "board.page.heading" back, a cycle: say it on one of them`,
      `${at('board.page.status', 'without[0]')}: "board.page.heading" names "board.page.status" back, a cycle: say it on one of them`,
      `${at('board.notice.message', 'with[0]')}: "board.ban.unban-button" names "board.notice.message" back through "board.marks.banned-badge", "board.notice.retry-button", a cycle: say it on one of them`,
      `${at('board.notice.retry-button', 'with[0]')}: "board.notice.message" names "board.notice.retry-button" back through "board.ban.unban-button", "board.marks.banned-badge", a cycle: say it on one of them`,
      `${at('board.marks.banned-badge', 'with[0]')}: "board.notice.retry-button" names "board.marks.banned-badge" back through "board.notice.message", "board.ban.unban-button", a cycle: say it on one of them`,
      `${at('board.ban.unban-button', 'with[0]')}: "board.marks.banned-badge" names "board.ban.unban-button" back through "board.notice.retry-button", "board.notice.message", a cycle: say it on one of them`,
    ])
  })

  it('wants the entries of an anchor of an entry to name anchors of the same entry', () => {
    const contract = board()

    anchorOf(contract, 'board.list.end-button').without = [
      'board.list.current-badge',
      'board.marks.banned-badge',
      'board.list.entry-item',
    ]

    expect(printed(contract)).toEqual([
      `${at('board.list.end-button', 'without[1]')}: "board.marks.banned-badge" is outside the entry of "board.list.entry-item": an anchor of an entry names anchors of the same entry`,
      `${at('board.list.end-button', 'without[2]')}: "board.list.entry-item" is outside the entry of "board.list.entry-item": an anchor of an entry names anchors of the same entry`,
    ])
  })

  it('lets an anchor outside the entries name one of them, and the list name what is outside', () => {
    const contract = board()

    anchorOf(contract, 'board.ban.ban-button').without = [
      'board.marks.banned-badge',
      'board.list.current-badge',
    ]
    anchorOf(contract, 'board.list').without = ['board.page.status']

    expect(printed(contract)).toEqual([])
  })
})
