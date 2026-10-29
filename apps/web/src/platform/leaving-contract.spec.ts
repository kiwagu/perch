/**
 * The frame guards the leaves the contract names: its policy is the platform's `unsavedInput`,
 * and the controls that ask first are those of the contract, every anchor (a dialog aside, whose
 * confirm already answered a question) one of whose bindings runs an action of `leaving`.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type AnchorDef, formatProblem, loadScreens } from '@workspace/ui-contract'

import { LEAVE_POLICY, LEAVING_CONTROLS } from './leaving'

const ROOT = join(import.meta.dirname, '../../../..')

const refsOf = (def: AnchorDef) =>
  def.binding === undefined ? [] : Array.isArray(def.binding) ? def.binding : [def.binding]

describe('the leaves of the contract', () => {
  const { screens, problems } = loadScreens(ROOT)

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
  })

  it('are guarded as the platform declares them', () => {
    expect(LEAVE_POLICY).toEqual(screens?.platform.unsavedInput)
  })

  it('ask first at the controls bound to a leaving action', () => {
    const leaving = new Set(screens?.platform.leaving ?? [])

    expect(leaving.size).toBeGreaterThan(0)
    expect([...LEAVING_CONTROLS].sort()).toEqual(
      (screens?.screens ?? [])
        .flatMap((screen) =>
          Object.entries(screen.anchors)
            .filter(
              ([, def]) =>
                def.kind !== 'dialog' &&
                refsOf(def).some((ref) => 'action' in ref && leaving.has(ref.action)),
            )
            .map(([anchor]) => anchor),
        )
        .sort(),
    )
  })
})
