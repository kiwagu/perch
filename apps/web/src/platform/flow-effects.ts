/**
 * The params of a flow's effects as a screen's machine takes them: `show` an anchor with one of
 * its codes, `clear` an anchor (its code, or a field's value), `navigate` to a binding
 * (`navigate-search.ts`). A machine keeps what its own anchors show for its view and emits the
 * rest for its host: the frame's anchors (`frame-effects.ts`), a field to empty, a move.
 */

export type { FieldValues, ItemIds, NavigateParams } from './navigate-search'

export interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

export interface ClearParams {
  readonly anchor: string
}
