/**
 * The sets of anchors several states render, `flow.meta.renders: { <set>: [anchors] }`: each name
 * a state lists in its `meta.renders` is replaced, in place, by the anchors of its set, so the
 * canonical flow lists anchors only, exactly as if the states had written them, and the map of
 * sets is gone. A map the schema refuses, a name no set declares and a set fewer than two states
 * list are issues. A flow that writes no map and lists no name comes back as it is.
 */

import { isRecord, recordOf } from '../../records'
import { renderSetsSchema } from '../../schemas'
import { englishErrors } from '../parse-file'

import type { ExpansionIssue } from './expansion'

type Sets = ReadonlyMap<string, readonly string[]>

/** What the states are read against: the sets, how many states list each, and the issues. */
interface Reading {
  readonly sets: Sets
  readonly listedBy: Map<string, number>
  readonly issues: ExpansionIssue[]
}

const NO_SETS: Sets = new Map()

/** A set name holds no dot, as every anchor does. */
const isSetName = (entry: unknown): entry is string =>
  typeof entry === 'string' && !entry.includes('.')

/** The entries of a state's `meta.renders` with each set name written out, in place. */
function entriesOf(
  entries: readonly unknown[],
  reading: Reading,
  at: readonly PropertyKey[],
): unknown[] {
  const listed = new Set<string>()
  const written = entries.flatMap((entry): readonly unknown[] => {
    if (!isSetName(entry)) {
      return [entry]
    }

    const anchors = reading.sets.get(entry)

    if (anchors === undefined) {
      reading.issues.push({ at, message: `"${entry}" names no set of flow.meta.renders` })

      return [entry]
    }

    listed.add(entry)

    return anchors
  })

  for (const name of listed) {
    reading.listedBy.set(name, (reading.listedBy.get(name) ?? 0) + 1)
  }

  return written
}

/** `states` with the sets of each state written out: the very `states` when none has a name. */
function statesOf(
  states: Readonly<Record<string, unknown>>,
  reading: Reading,
  at: readonly PropertyKey[],
): Readonly<Record<string, unknown>> {
  const read = Object.entries(states).map(([name, state]) => {
    const next = stateOf(state, reading, [...at, name])

    return { name, next, changed: next !== state }
  })

  return read.some(({ changed }) => changed)
    ? Object.fromEntries(read.map(({ name, next }) => [name, next]))
    : states
}

/** `state` with the sets of its `meta.renders` written out, and of the states below it. */
function stateOf(state: unknown, reading: Reading, at: readonly PropertyKey[]): unknown {
  if (!isRecord(state)) {
    return state
  }

  const meta = recordOf(state['meta'])
  const entries = Array.isArray(meta['renders']) ? meta['renders'] : []
  const named = entries.some(isSetName)
  const renders = named ? entriesOf(entries, reading, [...at, 'meta', 'renders']) : entries
  const children = state['states']
  const below = isRecord(children) ? statesOf(children, reading, [...at, 'states']) : children

  if (!named && below === children) {
    return state
  }

  return {
    ...state,
    ...(named ? { meta: { ...meta, renders } } : {}),
    ...(below === children ? {} : { states: below }),
  }
}

/**
 * `flow` with every set name its states list in `meta.renders` written out, at every depth of
 * states, and its map of sets taken out (an empty `meta` with it); `at` is where the flow sits in
 * its file. A flow that writes no map is read all the same: a name it lists has no set. A map the
 * schema refuses leaves the flow as written, with its issues alone.
 */
export function withRenderSets(
  flow: Readonly<Record<string, unknown>>,
  at: readonly PropertyKey[],
): { flow: Readonly<Record<string, unknown>>; issues: ExpansionIssue[] } {
  const { renders: map, ...otherMeta } = recordOf(flow['meta'])
  const setsAt = [...at, 'meta', 'renders']
  const parsed =
    map === undefined ? undefined : renderSetsSchema.safeParse(map, { error: englishErrors })

  if (parsed?.success === false) {
    return {
      flow,
      issues: parsed.error.issues.map((issue) => ({
        at: [...setsAt, ...issue.path],
        message: issue.message,
      })),
    }
  }

  const reading: Reading = {
    sets: parsed === undefined ? NO_SETS : new Map(Object.entries(parsed.data)),
    listedBy: new Map(),
    issues: [],
  }
  const children = flow['states']
  const states = isRecord(children) ? statesOf(children, reading, [...at, 'states']) : children

  for (const name of reading.sets.keys()) {
    const count = reading.listedBy.get(name) ?? 0

    if (count < 2) {
      reading.issues.push({
        at: [...setsAt, name],
        message: `the set "${name}" is listed by ${count === 0 ? 'no state' : 'one state'}: a set is for two states or more, list its anchors where a state renders them`,
      })
    }
  }

  if (parsed === undefined && states === children) {
    return { flow, issues: reading.issues }
  }

  const { meta, ...rest } = flow
  const left = Object.keys(otherMeta).length > 0 ? otherMeta : undefined
  const kept = parsed === undefined ? meta : left

  return {
    flow: { ...rest, ...(kept === undefined ? {} : { meta: kept }), states },
    issues: reading.issues,
  }
}
