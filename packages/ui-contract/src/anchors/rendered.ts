/**
 * What a state of a screen's flow renders, read from the flow or from an app's machine config
 * alike (`meta.renders`), so the app and the e2e harness read it the same way. An anchor that no
 * state lists, nor an anchor it is nested under, is rendered in every state. One that is listed
 * (`isListed`) is rendered only where a state the machine is in lists it or an anchor it is
 * nested under (`<anchor>.<rest>`: a composite's items under its list, a part derived from its
 * base): a plain state of the root by its own list, a parallel state by its own list, and each
 * of its regions by the list of the state that region is in. Rendered means visible to the
 * user: an anchor a state does not render is absent from the page or hidden on it.
 */

import { entriesOf, recordOf } from '../records'

import { isUnder } from './grammar'

/** The names of a flow that only some states render, and those the current state renders. */
export interface RenderedAt {
  /** Every name a state of the flow lists: it renders, with what is under it, only where listed. */
  readonly listed: readonly string[]
  /** The names the states the machine is in list. */
  readonly rendered: readonly string[]
}

/** The value of `key` in `value` read as a record, unless only the prototype has it. */
const fieldOf = (value: unknown, key: string): unknown => {
  const record = recordOf(value)

  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** The names a state lists in `meta.renders`. */
function listedBy(state: unknown): string[] {
  const renders = fieldOf(fieldOf(state, 'meta'), 'renders')

  return Array.isArray(renders)
    ? renders.filter((name: unknown): name is string => typeof name === 'string')
    : []
}

const statesIn = (node: unknown): unknown[] =>
  entriesOf(fieldOf(node, 'states')).map(([, state]) => state)

/** Every state of the config: those of the root, and those of each region of a parallel state. */
const everyState = (config: unknown): unknown[] =>
  statesIn(config).flatMap((state) => [
    state,
    ...(fieldOf(state, 'type') === 'parallel' ? statesIn(state).flatMap(statesIn) : []),
  ])

/**
 * The states the machine is in at `value`, XState's state value: a state of the root, or a
 * parallel state with the state each of its regions is in.
 */
function activeAt(config: unknown, value: unknown): unknown[] {
  const root = fieldOf(config, 'states')

  if (typeof value === 'string') {
    return [fieldOf(root, value)]
  }

  return entriesOf(value).flatMap(([name, regions]) => {
    const parallel = fieldOf(root, name)

    return [
      parallel,
      ...entriesOf(fieldOf(parallel, 'states')).map(([region, node]) => {
        const state = fieldOf(regions, region)

        return typeof state === 'string' ? fieldOf(fieldOf(node, 'states'), state) : undefined
      }),
    ]
  })
}

/** What the state at `value` of a flow or a machine `config` renders beyond the base set. */
export function renderedAt(config: unknown, value: unknown): RenderedAt {
  return {
    listed: [...new Set(everyState(config).flatMap(listedBy))],
    rendered: [...new Set(activeAt(config, value).flatMap(listedBy))],
  }
}

/** Whether `anchor` renders only where listed: a state lists it or an anchor it is under. */
export const isListed = (at: RenderedAt, anchor: string): boolean =>
  at.listed.some((name) => isUnder(name, anchor))

/** Whether the state renders `anchor`: no state lists it, or this one lists it or a container. */
export const isRendered = (at: RenderedAt, anchor: string): boolean =>
  !isListed(at, anchor) || at.rendered.some((name) => isUnder(name, anchor))
