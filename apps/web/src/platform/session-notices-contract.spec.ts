/**
 * The sign-in page says one of the words left for it, the first by the rank the contract gives
 * `user.sign-in.notice-message` (`ranked`): `SESSION_NOTICES` lists the words in that order, and
 * the page reads by it. On a branch the pre-commit hook sets `CONTRACT_AHEAD=1`: a business commit
 * may rank a word before its implementation, so the list may lack a word the contract added, never
 * hold one the contract does not rank or two in another order; `bun run check` and `main` want the
 * whole rank.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { SESSION_NOTICES } from './session.port'

const ROOT = join(import.meta.dirname, '../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'
const NOTICE = 'user.sign-in.notice-message'

describe("the rank of the sign-in page's words", () => {
  const { screens, problems } = loadScreens(ROOT)
  const [anchor] = (screens?.screens ?? []).flatMap((screen) => {
    const def = screen.anchors[NOTICE]

    return def === undefined ? [] : [def]
  })

  it('loads without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  it('is the order of the words the app leaves for the page', () => {
    const rank = anchor?.codes ?? []
    const words: readonly string[] = SESSION_NOTICES

    expect(anchor?.ranked).toBe(true)
    expect(rank.length).toBeGreaterThan(1)
    expect(words).toEqual(AHEAD ? rank.filter((code) => words.includes(code)) : rank)
  })
})
