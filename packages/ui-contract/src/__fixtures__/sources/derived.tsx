// Derived anchors: testIdFor() with a literal suffix, one whose suffix is built at runtime, and one whose base is a literal.
import { testIdFor } from '@workspace/ui-contract/anchors'

export const optionOf = (base: string): string => testIdFor(base, 'option')

export const confirmOf = (base: string): string => testIdFor(base, `confirm-button`)

export const anyOf = (base: string, suffix: string): string => testIdFor(base, suffix)

export const eyeOf = (): string => testIdFor('sample.title-input', 'visibility-button')
