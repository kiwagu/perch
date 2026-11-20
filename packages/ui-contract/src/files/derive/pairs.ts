/**
 * The guards of a password pair, derived from its confirmation: a secret `input` that writes
 * `confirms: <secret input>` (the password typed again, naming the new password it repeats) makes
 * the two a pair, and of the four guards a pair implies (`PAIR_GUARDS`) each one the screen's flow
 * names is added to its `meta.guards`; one it does not name is not, so every guard declared stays
 * used. The confirmation is a secret input with no binding that names another secret input of its
 * screen, one that opts into a composite, and a screen holds one pair: any other `confirms` is a
 * problem and derives nothing. A guard of a pair is derived only, so one a screen file writes is a
 * problem at every version; from version 4 a screen with a pair never writes one of the four names
 * either, used or not, and before it a name the screen writes keeps its written guard. Derived on
 * the parsed screen, its flow canonical, so a name is used where every check reads it used: on an
 * event, or in an outcome of an invoke.
 */

import { flowNodes, transitionsOf } from '../flow-nodes'
import { jsonPath, type Problem } from '../problems'
import type { AnchorDef, Flow, Screen } from '../screens'

/** A guard as the canonical flow holds it. */
type FlowGuard = NonNullable<NonNullable<Flow['meta']>['guards']>[string]

/** The version from which a screen with a pair never writes the guards the pair derives. */
const PAIR_GUARDS_EDITION = 4

/** The guards a password pair derives, by the name a flow uses, each with what it holds. */
export const PAIR_GUARDS = {
  passwordBreaksRules: { composite: 'breaks' },
  passwordsDiffer: { confirms: 'differs' },
  confirmationStrays: { confirms: 'strays' },
  confirmationFollows: { confirms: 'follows' },
} as const satisfies Readonly<Record<string, FlowGuard>>

/** Whether `guard` is one only the loader derives: neither a sentence nor failure codes. */
const isDerived = (guard: FlowGuard): boolean => typeof guard !== 'string' && !('codes' in guard)

/** Why the `confirms` of `anchor` makes no pair, if it does not. */
function misuseOf(anchor: string, def: AnchorDef, anchors: Screen['anchors']): string | undefined {
  const named = def.confirms ?? ''
  const confirmed = Object.hasOwn(anchors, named) ? anchors[named] : undefined

  if (def.kind !== 'input' || def.secret !== true) {
    return 'only a secret input confirms another'
  }

  if (def.binding !== undefined) {
    return 'a confirmation is never sent, so it has no binding'
  }

  return named === anchor ||
    confirmed?.kind !== 'input' ||
    confirmed.secret !== true ||
    confirmed.composite === undefined
    ? `"${named}" is not another secret input of the screen with a composite`
    : undefined
}

/** The guards the flow uses: on the events of its states and in the outcomes of their invokes. */
const usedGuardsOf = (flow: Flow): ReadonlySet<string> =>
  new Set(
    flowNodes(flow)
      .flatMap((node) => (node.kind === 'region' ? [] : transitionsOf(node.state)))
      .flatMap(({ guard }) => (guard === undefined ? [] : [guard])),
  )

/** `screen`, parsed, with the guards of its password pair its flow uses, and the problems found. */
export function withDerivedPairGuards(
  file: string,
  screen: Screen,
  edition: number,
): { screen: Screen; problems: Problem[] } {
  const problems: Problem[] = []
  const problemAt = (at: readonly PropertyKey[], message: string): void => {
    problems.push({ file, message: `${jsonPath(at)}: ${message}` })
  }
  const written = screen.flow?.meta?.guards ?? {}

  for (const [name, guard] of Object.entries(written)) {
    if (isDerived(guard)) {
      problemAt(
        ['flow', 'meta', 'guards', name],
        'a guard of a password pair is derived from its confirmation: a screen file never writes it',
      )
    }
  }

  let confirmation: string | undefined

  for (const [anchor, def] of Object.entries(screen.anchors)) {
    if (def.confirms === undefined) {
      continue
    }

    const at = ['anchors', anchor, 'confirms']
    const misuse = misuseOf(anchor, def, screen.anchors)

    if (misuse !== undefined) {
      problemAt(at, misuse)
    } else if (confirmation !== undefined) {
      problemAt(at, `a screen holds one password pair, and ${confirmation} confirms already`)
    } else {
      confirmation = anchor
    }
  }

  const { flow } = screen

  if (confirmation === undefined || flow === undefined) {
    return { screen, problems }
  }

  for (const name of Object.keys(PAIR_GUARDS)) {
    if (edition >= PAIR_GUARDS_EDITION && Object.hasOwn(written, name)) {
      problemAt(
        ['flow', 'meta', 'guards', name],
        `derived from the confirms of ${confirmation}; leave it out`,
      )
    }
  }

  const used = usedGuardsOf(flow)
  // Before version 4 a name the screen writes keeps its written guard.
  const derived = Object.entries(PAIR_GUARDS).filter(
    ([name]) => used.has(name) && !Object.hasOwn(written, name),
  )

  return derived.length === 0
    ? { screen, problems }
    : {
        screen: {
          ...screen,
          flow: {
            ...flow,
            meta: { ...flow.meta, guards: { ...written, ...Object.fromEntries(derived) } },
          },
        },
        problems,
      }
}
