/**
 * The region of a button bound to one action, derived from its binding: it rests in `idle`, the
 * button's event moves it to `running`, which invokes the action with the parameters the
 * binding passes, and both outcomes lead back to `idle`; a failure shows its codes on the error
 * anchor of the button's part. A region written as `by: <button>` is that region with the
 * outcomes it writes (a transition without a target goes back to `idle`; a branch that says
 * `read: false`, nothing reads after that outcome, keeps the key) and the `toast: false`
 * or `read: false` it says, passed on to its invoke; a button bound to one
 * action that no state of the flow handles gets it, when the root of the flow has one parallel
 * state.
 */

import { isRecord, recordOf } from '../../records'
import { controlRegionSchema } from '../../schemas'
import { type Control, failureCodes } from '../derive'

import { transitionsOf } from './effects'
import type { Expansion } from './expansion'
import { parsed } from './parsed'

const IDLE = 'idle'
const RUNNING = 'running'

/** The success of an action of the model, by the kind its name starts with. */
const DONE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^[a-z_]+\.create[A-Z]/, 'The controls whose values the action took are emptied.'],
  [/^[a-z_]+\.update[A-Z]/, 'The controls show the stored value.'],
  [/^[a-z_]+\.delete[A-Z]/, 'The entry leaves its list.'],
]

/** A transition that names no target goes back to `idle`; absent, so does it. */
function backToIdle(value: unknown): unknown {
  if (value === undefined) {
    return { target: IDLE }
  }

  const one = (each: unknown): unknown =>
    isRecord(each) && each['target'] === undefined ? { target: IDLE, ...each } : each

  return Array.isArray(value) ? value.map(one) : one(value)
}

function doneOf({ src }: Control): unknown {
  const said = DONE.find(([kind]) => kind.test(src))?.[1]

  return said === undefined ? { target: IDLE } : { target: IDLE, description: said }
}

/** The failure of the control's action, shown on the error of its part. */
function errorOf(control: Control, expansion: Expansion, at: readonly PropertyKey[]): unknown {
  const codes = failureCodes(expansion.failureOf(control.src))

  if (codes.length === 0) {
    return { target: IDLE }
  }

  if (control.error === undefined) {
    const part = control.anchor.slice(0, control.anchor.lastIndexOf('.'))

    expansion.issues.push({
      at,
      message: `${control.anchor} runs ${control.src}, whose failure shows ${codes.join(', ')}, and the screen declares no ${part}.error: declare it, or write the region with by: ${control.anchor} and its onError`,
    })

    return { target: IDLE }
  }

  return {
    target: IDLE,
    actions: [{ type: 'show', params: { anchor: control.error, codes: [...codes] } }],
  }
}

interface Written {
  readonly description?: string
  readonly onDone?: unknown
  readonly onError?: unknown
  readonly toast?: false
  readonly read?: false
}

function regionOf(
  control: Control,
  written: Written,
  expansion: Expansion,
  at: readonly PropertyKey[],
): unknown {
  const { anchor, src, input } = control

  return {
    description:
      written.description ??
      `Derived from the binding of ${anchor}: it runs ${src}, and the region waits in ${RUNNING} until it ends.`,
    initial: IDLE,
    states: {
      [IDLE]: { on: { [anchor]: { target: RUNNING } } },
      [RUNNING]: {
        invoke: {
          src,
          ...(input === undefined ? {} : { input }),
          ...(written.toast === false ? { toast: false } : {}),
          ...(written.read === false ? { read: false } : {}),
          onDone:
            written.onDone === undefined
              ? doneOf(control)
              : backToIdle(transitionsOf(written.onDone, expansion, [...at, 'onDone'])),
          onError:
            written.onError === undefined
              ? errorOf(control, expansion, at)
              : backToIdle(transitionsOf(written.onError, expansion, [...at, 'onError'], src)),
        },
      },
    },
  }
}

/**
 * The region a region written as `by: <button>` stands for, complete (`expanded`), or the
 * region as it is: one without `by`, for the caller to walk, or one that is wrong, with its
 * issues reported.
 */
export function controlRegionOf(
  region: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): { region: unknown; expanded: boolean } {
  if (!isRecord(region) || region['by'] === undefined || region['pattern'] !== undefined) {
    return { region, expanded: false }
  }

  const written = parsed(controlRegionSchema, region, expansion, at)

  if (written === undefined) {
    return { region, expanded: true }
  }

  const control = expansion.controls.find(({ anchor }) => anchor === written.by)

  if (control === undefined) {
    expansion.issues.push({
      at: [...at, 'by'],
      message: `${written.by} is not a button of the screen bound to one action`,
    })

    return { region, expanded: true }
  }

  return { region: regionOf(control, written, expansion, at), expanded: true }
}

/**
 * The events the states handle, and the buttons of the regions written by `by` that did not
 * expand (their mistakes are reported).
 */
function handledOf(states: unknown, handled = new Set<string>()): Set<string> {
  for (const state of Object.values(recordOf(states))) {
    for (const event of Object.keys(recordOf(recordOf(state)['on']))) {
      handled.add(event)
    }

    const { by } = recordOf(state)

    if (typeof by === 'string') {
      handled.add(by)
    }

    handledOf(recordOf(state)['states'], handled)
  }

  return handled
}

/** The name of a button's derived region: the button without its screen and its kind. */
const nameOf = (anchor: string, screen: string): string =>
  (anchor.startsWith(`${screen}.`) ? anchor.slice(screen.length + 1) : anchor)
    .replace(/-button$/, '')
    .replaceAll('.', '-')

/**
 * `states`, the states of the root as expanded, with a region derived for each button bound to
 * one action that they handle nowhere (a pattern's or a button's region included, once
 * expanded), after the regions written in the one parallel state of the root. A flow whose
 * root has no parallel state, or several, gets none: there a button the flow does not handle
 * stays as written.
 */
export function withDerivedRegions(
  states: Readonly<Record<string, unknown>>,
  expansion: Expansion,
): Readonly<Record<string, unknown>> {
  const handled = handledOf(states)
  const left = expansion.controls.filter(({ anchor }) => !handled.has(anchor))
  const parallel = Object.keys(states).filter(
    (name) => recordOf(states[name])['type'] === 'parallel',
  )
  const [only] = parallel

  if (left.length === 0 || only === undefined || parallel.length > 1) {
    return states
  }

  const regions: Record<string, unknown> = { ...recordOf(recordOf(states[only])['states']) }

  for (const control of left) {
    const name = nameOf(control.anchor, expansion.screen)

    if (name in regions) {
      expansion.issues.push({
        at: ['anchors', control.anchor, 'binding'],
        message: `the region derived for ${control.anchor} is named ${name}, which the parallel state ${only} has already: write it as a region with by: ${control.anchor}`,
      })
    } else {
      regions[name] = regionOf(control, {}, expansion, ['anchors', control.anchor, 'binding'])
    }
  }

  return { ...states, [only]: { ...recordOf(states[only]), states: regions } }
}
