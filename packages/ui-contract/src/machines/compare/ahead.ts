/**
 * A flow may run ahead of the app's machine on a branch: a business commit changes the flow,
 * the implementation commit after the developer's review brings the machine up to it. The
 * machine may then lack what the flow added (a state, an event, a guarded branch, an effect, a
 * region, an invoke) but does nothing the flow does not say: every state, event, transition,
 * target, guard, effect and invoke source it has is the flow's, its effects in the flow's order.
 */

import type {
  ProjectedEffect,
  ProjectedRegion,
  ProjectedState,
  ProjectedTransition,
  Projection,
} from './projection'
import { sameValue } from './records'

/** Whether `part` is `whole` with some of its items left out, the rest in order. */
const within = <T>(
  part: readonly T[],
  whole: readonly T[],
  same: (a: T, b: T) => boolean,
): boolean =>
  part.reduce<readonly T[] | undefined>((rest, each) => {
    const at = rest?.findIndex((other) => same(each, other)) ?? -1

    return at < 0 ? undefined : rest?.slice(at + 1)
  }, whole) !== undefined

const sameTransition = (app: ProjectedTransition, flow: ProjectedTransition): boolean =>
  sameValue(app.target, flow.target) &&
  sameValue(app.guard, flow.guard) &&
  within(app.effects, flow.effects, sameValue)

/** The app's list when it is the flow's with items left out, else the flow's: they differ. */
const effectsOf = (app: readonly ProjectedEffect[], flow: readonly ProjectedEffect[]) =>
  within(app, flow, sameValue) ? app : flow

const transitionsOf = (
  app: readonly ProjectedTransition[],
  flow: readonly ProjectedTransition[],
) => (within(app, flow, sameTransition) ? app : flow)

/**
 * The flow's entries the app has too, each through `of`; one the app alone has is left out.
 * Only the app's own keys count: a state named `constructor` is not one every object has.
 */
function shared<T>(
  app: Readonly<Record<string, T>>,
  flow: Readonly<Record<string, T>>,
  of: (app: T, flow: T) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(flow).flatMap(([key, value]) => {
      const mine = Object.hasOwn(app, key) ? app[key] : undefined

      return mine === undefined ? [] : [[key, of(mine, value)]]
    }),
  )
}

function stateOf(app: ProjectedState, flow: ProjectedState): ProjectedState {
  const regions =
    flow.regions === undefined || app.regions === undefined
      ? flow.regions
      : shared(app.regions, flow.regions, regionOf)

  return {
    final: flow.final,
    entry: effectsOf(app.entry, flow.entry),
    exit: effectsOf(app.exit, flow.exit),
    on: shared(app.on, flow.on, transitionsOf),
    invoke:
      app.invoke === undefined || flow.invoke === undefined
        ? undefined
        : {
            src: flow.invoke.src,
            onDone: transitionsOf(app.invoke.onDone, flow.invoke.onDone),
            onError: transitionsOf(app.invoke.onError, flow.invoke.onError),
          },
    ...(regions === undefined ? {} : { regions }),
  }
}

function regionOf(app: ProjectedRegion, flow: ProjectedRegion): ProjectedRegion {
  return { initial: flow.initial, states: shared(app.states, flow.states, stateOf) }
}

/**
 * The flow as far as the app's machine has come: equal to the machine's projection exactly
 * when the machine lags the flow and does nothing it does not say.
 */
export function aheadOf(app: Projection, flow: Projection): Projection {
  return { initial: flow.initial, states: shared(app.states, flow.states, stateOf) }
}
