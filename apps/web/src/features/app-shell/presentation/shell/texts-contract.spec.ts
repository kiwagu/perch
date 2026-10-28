/**
 * The one thing a new mutation asks a human to write is its words: every code the frame's
 * notice and toast carry in the contract has its entry in the frame's map, and the maps hold no
 * code the contract dropped. The i18n check holds the keys to both catalogs. On a branch the
 * pre-commit hook sets `CONTRACT_AHEAD=1`: a business commit may give the frame a code before
 * its implementation writes the words, so a map may lack a code the contract added but holds
 * none it does not say; `bun run check` and a commit on `main` want every code worded.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { englishCatalog, loadSpanishCatalog } from '../../../../platform/catalogs'

import { NOTICE_TEXTS } from './notice-texts'
import { TOAST_TEXTS } from './toast-texts'

const ROOT = join(import.meta.dirname, '../../../../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

/**
 * What the notice's line holds without growing (`shell.view.tsx`): three lines on a 360px phone,
 * about 44 characters each at the notice's size; wider up it holds two longer ones.
 */
const NOTICE_LINE_CHARACTERS = 132

describe('the words of the frame', () => {
  const { screens, problems } = loadScreens(ROOT)
  const frame = screens?.screens.find((screen) => screen.id === 'app-shell')
  const codesOf = (anchor: string): readonly string[] => frame?.anchors[anchor]?.codes ?? []
  const gaps = (anchor: string, texts: Readonly<Record<string, unknown>>) => ({
    unworded: AHEAD ? [] : codesOf(anchor).filter((code) => !Object.hasOwn(texts, code)),
    stale: Object.keys(texts).filter((code) => !codesOf(anchor).includes(code)),
  })

  it('load from the contract', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(codesOf('app-shell.toast').length).toBeGreaterThan(0)
  })

  it('give every code of the notice and of the toast its words, and no other', () => {
    expect(gaps('app-shell.notice-message', NOTICE_TEXTS)).toEqual({ unworded: [], stale: [] })
    expect(gaps('app-shell.toast', TOAST_TEXTS)).toEqual({ unworded: [], stale: [] })
  })

  it('keep every notice, in either language, within the line the frame holds for it', async () => {
    const catalogs = [englishCatalog, await loadSpanishCatalog()]
    const longer = catalogs.flatMap((catalog) =>
      Object.entries(NOTICE_TEXTS).flatMap(([code, text]) => {
        const words = text((key) => catalog[key] ?? key)

        return words.length > NOTICE_LINE_CHARACTERS ? [`${code}: ${words}`] : []
      }),
    )

    expect(longer).toEqual([])
  })
})
