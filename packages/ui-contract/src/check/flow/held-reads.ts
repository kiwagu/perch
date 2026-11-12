/**
 * The reads an action's success holds. An invoke holds a list, a section or a table of its own
 * screen whose `source` is a platform action when its action may change what that list shows:
 * a value of its `input` is an entry of the list (an `item` or a `row` it contains,
 * `containersOf`), a value of its `input` is one the source's `params` take too (as JSON), or
 * its action, of the platform or of the model, names the source among its `changes`. Every
 * branch of its `onDone` (a single transition is one) then reads each list it holds, `read:
 * <list>`, or says `read: false`, nothing reads after this outcome. A failure holds nothing, so
 * an `onError` reads where it says; an invoke that says `read: false` holds nothing; a list
 * whose source is an entity follows the stored data and is never held, nor is a list of another
 * screen. The flow is the loader's expansion, so a region written `by` its button is held as
 * its invoke. The schema wants an `onDone` on every invoke, so none lacks one.
 */

import { containersOf, ENTRY_KINDS, LISTING_KINDS } from '../../anchors'
import type { FlowState, FlowTransition, Problem, Screen } from '../../files'
import { entityMemberOf, own, PLATFORM_ACTION } from '../contract'
import type { PlatformSource } from '../lookups'

import type { At, InFlow } from './in-flow'
import { placed } from './reads'

type Invoke = NonNullable<FlowState['invoke']>

/** A list of the screen whose source is a platform action, with that source. */
interface Listing {
  readonly anchor: string
  readonly source: PlatformSource
}

/** The lists, sections and tables of `screen` whose source is a platform action. */
const platformListsOf = (screen: Screen): Listing[] =>
  Object.entries(screen.anchors).flatMap(([anchor, { kind, source }]) =>
    LISTING_KINDS.has(kind) && source !== undefined && 'platform' in source
      ? [{ anchor, source }]
      : [],
  )

/** The reads `src` names in its `changes`, a platform action's or one of the model's. */
function changesOf({ contract }: InFlow, src: string): readonly string[] {
  if (src.startsWith(PLATFORM_ACTION)) {
    return own(contract.screens.platform.actions, src.slice(PLATFORM_ACTION.length))?.changes ?? []
  }

  const { entity, member } = entityMemberOf(src)
  const actions = own(contract.model.entities, entity)?.actions

  return (actions === undefined ? undefined : own(actions, member)?.changes) ?? []
}

/** Why `invoke` holds `listing`, each reason in words; none where it holds it not. */
function reasonsFor(inFlow: InFlow, invoke: Invoke, { anchor, source }: Listing): string[] {
  const { anchors } = inFlow.screen
  const input = Object.entries(invoke.input ?? {})

  return [
    ...input.flatMap(([key, value]) =>
      typeof value === 'string' &&
      ENTRY_KINDS.has(own(anchors, value)?.kind ?? '') &&
      containersOf(value, anchors).includes(anchor)
        ? [`the input ${key} takes "${value}", an entry of it`]
        : [],
    ),
    ...input.flatMap(([key, value]) =>
      Object.entries(source.params ?? {}).flatMap(([param, taken]) =>
        JSON.stringify(value) === JSON.stringify(taken)
          ? [
              `the input ${key} takes ${JSON.stringify(value)}, which its source ${source.platform} takes for ${param}`,
            ]
          : [],
      ),
    ),
    ...(changesOf(inFlow, invoke.src).includes(source.platform)
      ? [`the action changes ${source.platform}, its source`]
      : []),
  ]
}

/** The anchors the reads among `branch`'s effects name. */
const readsOf = (branch: FlowTransition): ReadonlySet<string> =>
  new Set(
    (branch.actions ?? []).flatMap((effect) =>
      effect.type === 'read' ? [effect.params.anchor] : [],
    ),
  )

/** Each branch of `invoke`'s `onDone` that reads not a list it holds, once per list, at `at`. */
export function heldReadProblems(inFlow: InFlow, invoke: Invoke, at: At): Problem[] {
  if (invoke.read === false) {
    return []
  }

  const held = platformListsOf(inFlow.screen).flatMap((listing) => {
    const reasons = reasonsFor(inFlow, invoke, listing)

    return reasons.length === 0 ? [] : [{ anchor: listing.anchor, reasons }]
  })

  return placed(invoke.onDone, [...at, 'onDone']).flatMap(([branch, where]) => {
    if (branch.read === false) {
      return []
    }

    const reads = readsOf(branch)

    return held
      .filter(({ anchor }) => !reads.has(anchor))
      .map(({ anchor, reasons }) =>
        inFlow.inScreens(
          where,
          `"${anchor}" may show another answer once ${invoke.src} succeeds, as ${reasons.join(', and ')}: this outcome reads it, read: ${anchor}, or says nothing reads after it, read: false`,
        ),
      )
  })
}
