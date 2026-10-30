/** One flow as the checks of rule 8 read it, with the lookups of the whole contract. */

import type { AnchorDef, Binding, Flow, Screen } from '../../files'
import type { Lookups } from '../lookups'

export type At = readonly PropertyKey[]

export interface InFlow extends Lookups {
  readonly screen: Screen
  readonly flow: Flow
  /** Where the flow is: `screens[i].flow`. */
  readonly at: At
  readonly defs: ReadonlyMap<string, AnchorDef>
  readonly bindings: ReadonlyMap<string, Binding>
}
