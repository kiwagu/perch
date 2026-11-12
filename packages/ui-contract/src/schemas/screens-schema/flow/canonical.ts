/**
 * The behaviour of a screen as an XState v5 machine config, in the subset `createMachine`
 * takes verbatim: states, transitions on the anchors' events and the platform's, guards by
 * name, the effects `show`, `clear`, `read` and `navigate`, and an invoke per action. A state of the root may
 * be a parallel state, whose regions are the independent areas of the screen, each in one of
 * its plain states at a time; a transition of the root may name a region's state as
 * `<parallel>.<region>.<state>`, and one of a region's state a state of the root as
 * `#<flow id>.<state>`. Everything else XState knows (`context`, `after`, `always`, deeper
 * nesting, history, other targets by `#id`, `.child`, actions named by a string) is refused:
 * every object is strict. One key is the contract's alone, `read: false`, which XState ignores
 * and the machine comparison leaves out: on an invoke, nothing reads after its action; on a
 * branch of an invoke's `onDone` or `onError`, nothing reads after that outcome. This
 * is the flow every check, the walk in XState, the manifest and
 * an app's machine read; a screen file may author it shorter (`authored.ts`), and the loader
 * expands that into this.
 */

import { flowSchemaOf } from './build'
import { effectSchema } from './effects'
import { transitionSchemaOf } from './transitions'

export const transitionSchema = transitionSchemaOf(effectSchema)

export const flowSchema = flowSchemaOf({
  transition: transitionSchema,
  effect: effectSchema,
  region: (parts) => parts.region,
  regions: { min: 2, description: 'The regions by name, two or more.' },
  description: 'The flow of the screen: an XState v5 machine config.',
})
