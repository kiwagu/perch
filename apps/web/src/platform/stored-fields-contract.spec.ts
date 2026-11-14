/**
 * The fields that show a saved state are those the contract binds to a model field: the anchors
 * `showsStoredValue` selects. On a branch the pre-commit hook sets `CONTRACT_AHEAD=1`: a business
 * commit may add such a field before it is rendered, so the list may lack one the contract added,
 * never hold one it does not say; `bun run check` and `main` want the whole list.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens, showsStoredValue } from '@workspace/ui-contract'

import { STORED_FIELDS, storesValue } from './stored-fields'

const ROOT = join(import.meta.dirname, '../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

describe('the stored fields of the contract', () => {
  const { screens, problems } = loadScreens(ROOT)

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  it('stores at the fields the contract binds to a model field', () => {
    const fields = [...STORED_FIELDS]
    const contract = (screens?.screens ?? [])
      .flatMap((screen) =>
        Object.entries(screen.anchors)
          .filter(([, def]) => showsStoredValue(def))
          .map(([anchor]) => anchor),
      )
      .sort()

    expect(contract.length).toBeGreaterThan(0)
    expect(fields.sort()).toEqual(
      AHEAD ? contract.filter((anchor) => fields.includes(anchor)) : contract,
    )
  })

  it('answers for an anchor by the list', () => {
    expect(storesValue('user.profile.name-input')).toBe(true)
    expect(storesValue('user.settings.email.email-input')).toBe(false)
  })
})
