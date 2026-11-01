// Derived anchors: testIdFor() with a literal suffix, one whose suffix is built at runtime, and
// ones whose base is a literal: quoted, a template, wrapped, and a base no screen declares.
import { testIdFor } from '@workspace/ui-contract/anchors'

export const optionOf = (base: string): string => testIdFor(base, 'option')

export const confirmOf = (base: string): string => testIdFor(base, `confirm-button`)

export const anyOf = (base: string, suffix: string): string => testIdFor(base, suffix)

export const eyeOf = (): string => testIdFor('sample.title-input', 'visibility-button')

export const templateEyeOf = (): string => testIdFor(`sample.title-input`, 'visibility-button')

export const constEyeOf = (): string =>
  testIdFor('sample.title-input' as const, 'visibility-button')

export const checkedEyeOf = (): string =>
  testIdFor('sample.title-input' satisfies string, 'visibility-button')

export const strayConfirmOf = (): string => testIdFor('sample.gone-dialog', 'confirm-button')
