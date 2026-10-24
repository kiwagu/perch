import { entriesOf, isRecord, listOf, recordOf } from './records'

/** What a mechanism outside the flow subset is, by the key of a config that holds it. */
const ON_THE_ROOT = {
  on: 'transitions in every state',
  always: 'an eventless transition',
  after: 'a delayed transition',
  invoke: 'an actor of the whole machine',
}
const IN_A_STATE = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  states: 'nested states',
  onDone: 'a transition when nested states end',
}
const IN_A_PARALLEL_STATE = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  initial: 'an initial state of a parallel state',
  invoke: 'an actor of the whole parallel state',
  onDone: 'a transition when every region ends',
}
const IN_A_REGION = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  on: 'transitions in every state of a region',
  entry: 'effects on entering a region',
  exit: 'effects on leaving a region',
  invoke: 'an actor of a whole region',
  onDone: 'a transition when a region ends',
}
const IN_AN_INVOKE = { onSnapshot: "transitions on the actor's snapshots" }
const STATE_TYPES: Readonly<Record<string, string>> = { history: 'a history state' }
const REGION_TYPES: Readonly<Record<string, string>> = {
  parallel: 'a parallel state in a region',
  history: 'a history state',
  final: 'a region that ends',
}
const REGION_STATE_TYPES: Readonly<Record<string, string>> = {
  final: 'a state of a region that ends',
  parallel: 'a parallel state in a region',
  history: 'a history state',
}

const outside = (where: string, what: string): string =>
  `${where}: ${what} is outside the flow subset`

/** The keys of `node` among `mechanisms`, each a mechanism outside the subset at `where`. */
const keysIn = (node: Readonly<Record<string, unknown>>, where: string, mechanisms: object) =>
  Object.entries(mechanisms)
    .filter(([key]) => node[key] !== undefined)
    .map(([key, what]) => outside(where, `${key} (${String(what)})`))

/** The `type` of `node` when it is one of `types`, outside the subset at `where`. */
function typeIn(
  node: Readonly<Record<string, unknown>>,
  where: string,
  types: Readonly<Record<string, string>>,
): string[] {
  const type = String(node['type'])
  const what = types[type]

  return what === undefined ? [] : [outside(where, `type ${type} (${what})`)]
}

const reentriesIn = (transitions: unknown, where: string) =>
  listOf(transitions).flatMap((each, index) =>
    isRecord(each) && each['reenter'] === true
      ? [outside(`${where}[${index}]`, 'reenter (a transition that re-enters its state)')]
      : [],
  )

const eventsIn = (state: Readonly<Record<string, unknown>>, where: string) =>
  entriesOf(state['on']).flatMap(([event, of]) =>
    reentriesIn(of, `${where}.on[${JSON.stringify(event)}]`),
  )

/** What a plain state holds beyond the subset: of the root, or of a region with `types`. */
function plainBeyond(
  state: Readonly<Record<string, unknown>>,
  where: string,
  types: Readonly<Record<string, string>>,
): string[] {
  const { invoke } = state

  return [
    ...keysIn(state, where, IN_A_STATE),
    ...typeIn(state, where, types),
    ...(Array.isArray(invoke) ? [outside(where, 'invoke as a list (several actors)')] : []),
    ...eventsIn(state, where),
    ...(isRecord(invoke)
      ? [
          ...keysIn(invoke, `${where}.invoke`, IN_AN_INVOKE),
          ...reentriesIn(invoke['onDone'], `${where}.invoke.onDone`),
          ...reentriesIn(invoke['onError'], `${where}.invoke.onError`),
        ]
      : []),
  ]
}

/** What a region holds beyond the subset, and each of its states. */
function regionBeyond(region: Readonly<Record<string, unknown>>, where: string): string[] {
  return [
    ...keysIn(region, where, IN_A_REGION),
    ...typeIn(region, where, REGION_TYPES),
    ...(region['type'] === 'parallel'
      ? []
      : entriesOf(region['states']).flatMap(([name, value]) => {
          const state = recordOf(value)
          const at = `${where}.states.${name}`

          return [
            ...plainBeyond(state, at, REGION_STATE_TYPES),
            ...(recordOf(state['meta'])['address'] === undefined
              ? []
              : [outside(at, 'meta.address (an address of a state of a region)')]),
          ]
        })),
  ]
}

/**
 * What a machine config does that the flow subset has no counterpart for, each with where it
 * is: transitions on the root, eventless and delayed transitions, nested states but a parallel
 * state's regions, a parallel state's `initial`, `invoke` or `onDone`, anything of a region but
 * its `initial` and its plain states, a state of a region that ends or carries an address,
 * history states, several invokes, a transition that re-enters its state. The projection does
 * not see these, so an app machine using one is refused here, never compared as equal.
 */
export function beyondTheSubset(config: unknown): string[] {
  const root = recordOf(config)

  return [
    ...keysIn(root, '(root)', ON_THE_ROOT),
    ...entriesOf(root['states']).flatMap(([name, value]) => {
      const state = recordOf(value)
      const where = `states.${name}`

      return state['type'] === 'parallel'
        ? [
            ...keysIn(state, where, IN_A_PARALLEL_STATE),
            ...eventsIn(state, where),
            ...entriesOf(state['states']).flatMap(([region, of]) =>
              regionBeyond(recordOf(of), `${where}.states.${region}`),
            ),
          ]
        : plainBeyond(state, where, STATE_TYPES)
    }),
  ]
}
