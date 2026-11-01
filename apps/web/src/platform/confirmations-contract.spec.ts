/**
 * The frame asks before the destructive actions the contract names: the controls that ask are the
 * anchors of the contract that carry `asks`, each with its code, and the dialog is the frame's
 * confirmation. On a branch the pre-commit hook sets `CONTRACT_AHEAD=1`: a business commit may
 * make a control ask before its implementation, so the table may lack a control the contract
 * added, never hold one it does not say; `bun run check` and `main` want the whole table.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { ASKING_CONTROLS, CONFIRMATION } from './confirmations'

const ROOT = join(import.meta.dirname, '../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

describe('the questions of the contract', () => {
  const { screens, problems } = loadScreens(ROOT)
  const asking = Object.fromEntries(
    (screens?.screens ?? []).flatMap((screen) =>
      Object.entries(screen.anchors).flatMap(([anchor, def]) =>
        def.asks === undefined ? [] : [[anchor, def.asks] as const],
      ),
    ),
  )

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  it("are asked through the frame's confirmation, at the controls that carry them, with their codes", () => {
    const contract = Object.fromEntries(
      Object.entries(asking).map(([anchor, { dialog, code }]) => {
        expect(dialog).toBe(CONFIRMATION)

        return [anchor, code]
      }),
    )
    const table = AHEAD
      ? Object.fromEntries(Object.entries(contract).filter(([anchor]) => anchor in ASKING_CONTROLS))
      : contract

    expect(Object.keys(contract).length).toBeGreaterThan(0)
    expect(ASKING_CONTROLS).toEqual(table)
  })
})
