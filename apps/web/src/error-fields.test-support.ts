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
 * code the error carries. The error shows once, under its anchor and with the code; for a code
 * the contract places on a field, in that field after its control, whose control is marked
 * invalid, in the field marked so, and nothing else is; a code the contract gives `form` marks
 * nothing.
 */
export function expectEachCodeMarksItsField(error: string, show: (code: string) => void): void {
  const fields = errorFieldsOf(error)

  expect(Object.keys(fields).length, `the contract gives ${error} no fields`).toBeGreaterThan(0)

  for (const [code, anchor] of Object.entries(fields)) {
    show(code)

    const shown = [...document.querySelectorAll(`[data-testid="${error}"]`)]

    expect(shown, `${error} ${code}: the errors shown`).toHaveLength(1)
    expect(shown[0]?.getAttribute('data-code'), `${error} ${code}: the code shown`).toBe(code)

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

    for (const control of controls) {
      expect(
        control.closest('[data-slot="field"]')?.contains(shown[0] ?? null),
        `${error} ${code}: the error sits in the field of its control`,
      ).toBe(true)
      expect(
        control.compareDocumentPosition(shown[0] ?? control) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${error} ${code}: the error follows its control`,
      ).toBeTruthy()
    }

    cleanup()
  }
}
