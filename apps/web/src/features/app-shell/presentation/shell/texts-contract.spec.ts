/**
 * The one thing a new mutation asks a human to write is its words: every code the frame's
 * notice and toast carry in the contract has its entry in the frame's map, and the maps hold no
 * code the contract dropped. The i18n check holds the keys to both catalogs.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { NOTICE_TEXTS } from './notice-texts'
import { TOAST_TEXTS } from './toast-texts'

const ROOT = join(import.meta.dirname, '../../../../../../..')

describe('the words of the frame', () => {
  const { screens, problems } = loadScreens(ROOT)
  const frame = screens?.screens.find((screen) => screen.id === 'app-shell')
  const codesOf = (anchor: string): readonly string[] => frame?.anchors[anchor]?.codes ?? []
  const gaps = (anchor: string, texts: Readonly<Record<string, unknown>>) => ({
    unworded: codesOf(anchor).filter((code) => !Object.hasOwn(texts, code)),
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
})
