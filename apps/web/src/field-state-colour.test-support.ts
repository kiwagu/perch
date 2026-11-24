import { expect } from 'vitest'

import { stateBorder } from '@workspace/ui/unsaved-input'

/** The classes that colour a field's border by its state: a field the contract opts out shows none. */
const STATE_COLOURS = stateBorder(true).split(' ')

/** The state colours a field's border carries: none for a field the contract opts out. */
export function stateColoursOf(field: HTMLElement): readonly string[] {
  return [...field.classList].filter((name) => STATE_COLOURS.includes(name))
}

/** Expects a field that holds unsaved input (its `data-state` stays) to be drawn in no state colour. */
export function expectNoStateColour(field: HTMLElement): void {
  expect(field.getAttribute('data-state')).toBe('unsaved')
  expect(stateColoursOf(field)).toEqual([])
}
