import { join } from 'node:path'

import { cleanup } from '@testing-library/react'
import { expect } from 'vitest'

import { loadScreens } from '@workspace/ui-contract'

const ROOT = join(import.meta.dirname, '../../..')

/** The fields of an error anchor in the contract: each code with the field anchor it concerns, or `form`. */
export function errorFieldsOf(error: string): Readonly<Record<string, string>> {
  const { screens } = loadScreens(ROOT)
  const anchors = (screens?.screens ?? []).map((screen) => screen.anchors[error])
  const fields = anchors.find((anchor) => anchor !== undefined)?.fields

  expect(fields, `the contract gives ${error} no fields`).toBeDefined()

  return fields ?? {}
}

/**
 * Holds a view to the `fields` of its error in the contract: `show` renders the view with each
 * code the error carries, and the control of the field the code concerns is marked invalid, in the
 * field marked so, and nothing else is; a code the contract gives `form` marks nothing.
 */
export function expectEachCodeMarksItsField(error: string, show: (code: string) => void): void {
  const fields = errorFieldsOf(error)

  expect(Object.keys(fields).length, `the contract gives ${error} no fields`).toBeGreaterThan(0)

  for (const [code, anchor] of Object.entries(fields)) {
    show(code)

    const concerned = anchor === 'form' ? [] : [anchor]
    const controls = [...document.querySelectorAll('[aria-invalid="true"]')]
    const fieldsMarked = [...document.querySelectorAll('[data-slot="field"][data-invalid="true"]')]

    expect(
      controls.map((control) => control.getAttribute('data-testid')),
      `${error} ${code}: the controls marked invalid`,
    ).toEqual(concerned)
    expect(fieldsMarked, `${error} ${code}: the fields marked invalid`).toHaveLength(
      concerned.length,
    )
    expect(
      fieldsMarked.every((field) => controls.every((control) => field.contains(control))),
      `${error} ${code}: the field marked holds the control marked`,
    ).toBe(true)

    cleanup()
  }
}
