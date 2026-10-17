import { Clock, Deferred, Duration, Effect, Fiber, Layer, ManagedRuntime, Ref } from 'effect'

import type { Clock as ReplicaClock } from '../clock'

import { CADENCE_MS, type CadencePort, type PassKind } from './cadence'
import type { ChannelState } from './transport'

/** The cadence as Effect programs, run by `createEffectCadence` and by tests on `TestClock`. */
export interface CadenceProgram {
  readonly start: Effect.Effect<void>
  /** Interrupts the passes; completes once the pass under way has finished. */
  readonly stop: Effect.Effect<void>
  visibility(state: 'visible' | 'hidden'): Effect.Effect<void>
  channel(state: ChannelState): Effect.Effect<void>
}

interface CadenceState {
  readonly visible: boolean
  readonly channel: ChannelState
  readonly lastPass: number
  readonly lastFull: number
  /** The tab showed or the channel came up: a full pass runs at once. */
  readonly catchUp: boolean
  /** When the echo of the last catch-up falls due. */
  readonly echoAt: number | undefined
}

/** The pass the state calls for next and when it falls due; a full pass covers a probe. */
function nextPass(state: CadenceState): { readonly at: number; readonly kind: PassKind } {
  if (state.catchUp) {
    return { at: Number.NEGATIVE_INFINITY, kind: 'full' }
  }

  const interval = !state.visible
    ? CADENCE_MS.hidden
    : state.channel === 'up'
      ? CADENCE_MS.visibleUp
      : CADENCE_MS.down
  const probeAt = state.lastPass + interval
  const fullAt = Math.min(state.lastFull + CADENCE_MS.full, state.echoAt ?? Infinity)

  return probeAt < fullAt ? { at: probeAt, kind: 'probe' } : { at: fullAt, kind: 'full' }
}

/** The state once a pass of `kind` starts at `now`: a full pass also answers a catch-up or echo. */
function passStarted(state: CadenceState, kind: PassKind, now: number): CadenceState {
  if (kind === 'probe') {
    return { ...state, lastPass: now }
  }

  const echoed = state.echoAt !== undefined && state.echoAt <= now

  return {
    ...state,
    lastPass: now,
    lastFull: now,
    catchUp: false,
    echoAt: echoed ? undefined : state.echoAt,
  }
}

/**
 * The cadence on Effect, over whichever `Clock` service runs it. One fiber runs the passes, so
 * one pass runs at a time by construction: it sleeps until the next pass falls due, and a change
 * of state wakes it to plan again. A pass that fell due during another, or a catch-up, runs as
 * soon as the pass under way has finished. A pass is uninterruptible, so a stop lets it finish.
 */
export const makeCadence = Effect.fnUntraced(function* (
  pass: (kind: PassKind) => Effect.Effect<void>,
): Effect.fn.Return<CadenceProgram> {
  const state = yield* Ref.make<CadenceState>({
    visible: true,
    channel: 'down',
    lastPass: 0,
    lastFull: 0,
    catchUp: false,
    echoAt: undefined,
  })
  /** Completed when the state changes, then replaced. */
  const changed = yield* Ref.make(yield* Deferred.make<void>())
  const started = yield* Ref.make(false)
  /** The fiber running the passes; once stopped, it may still be finishing its pass. */
  const passes = yield* Ref.make<Fiber.Fiber<never> | undefined>(undefined)

  /**
   * Waits until the next pass falls due, planning again whenever the state changes. A catch-up,
   * or a pass that fell due during the last one, runs at once; after a change of state the next
   * pass waits for the clock even when it is due already, so it never runs inside the change.
   */
  const nextDue = Effect.gen(function* () {
    let woken = false

    for (;;) {
      const now = yield* Clock.currentTimeMillis
      const current = yield* Ref.get(state)
      const next = nextPass(current)

      if (current.catchUp || (next.at <= now && !woken)) {
        return next.kind
      }

      woken = yield* Effect.raceFirst(
        Effect.as(Effect.sleep(Duration.millis(Math.max(0, next.at - now))), false),
        Effect.as(Deferred.await(yield* Ref.get(changed)), true),
      )

      if (!woken) {
        return next.kind
      }
    }
  })

  const runPass = Effect.fnUntraced(function* (kind: PassKind) {
    const now = yield* Clock.currentTimeMillis

    yield* Ref.update(state, (current) => passStarted(current, kind, now))
    yield* Effect.uninterruptible(pass(kind))
  })

  // `disableYield`: by default `forever` yields to the scheduler between passes, so the next
  // sleep would be planned only after the event loop had turned.
  const loop = Effect.forever(Effect.flatMap(nextDue, runPass), { disableYield: true })

  /** Records the tab and the channel; a started cadence plans again, or catches up. */
  const change = Effect.fnUntraced(function* (
    update: Partial<Pick<CadenceState, 'visible' | 'channel'>>,
  ) {
    const before = yield* Ref.getAndUpdate(state, (current) => ({ ...current, ...update }))
    const after = yield* Ref.get(state)

    if (
      !(yield* Ref.get(started)) ||
      (before.visible === after.visible && before.channel === after.channel)
    ) {
      return
    }

    if ((after.visible && !before.visible) || (after.channel === 'up' && before.channel !== 'up')) {
      const now = yield* Clock.currentTimeMillis

      yield* Ref.update(state, (current) => ({
        ...current,
        catchUp: true,
        echoAt: now + CADENCE_MS.echo,
      }))
    }

    yield* Deferred.succeed(yield* Ref.getAndSet(changed, yield* Deferred.make<void>()), undefined)
  })

  return {
    start: Effect.gen(function* () {
      if (yield* Ref.getAndSet(started, true)) {
        return
      }

      const now = yield* Clock.currentTimeMillis
      // A loop stopped during its pass may still be finishing it; the new one waits for it.
      const stopped = yield* Ref.get(passes)

      yield* Ref.update(state, (current) => ({
        ...current,
        lastPass: now,
        lastFull: now,
        catchUp: false,
        echoAt: undefined,
      }))
      yield* Ref.set(
        passes,
        yield* Effect.forkDetach(stopped ? Effect.andThen(Fiber.await(stopped), loop) : loop, {
          startImmediately: true,
        }),
      )
    }),
    stop: Effect.gen(function* () {
      const fiber = yield* Ref.get(passes)

      if ((yield* Ref.getAndSet(started, false)) && fiber) {
        yield* Fiber.interrupt(fiber)
      }
    }),
    visibility: (visibility) => change({ visible: visibility === 'visible' }),
    channel: (channel) => change({ channel }),
  }
})

/** The replica's injected clock as Effect's `Clock` service: sleeps are its scheduled tasks. */
function clockLayer(clock: ReplicaClock): Layer.Layer<never> {
  const nanos = (): bigint => BigInt(clock.now()) * 1_000_000n

  return Layer.succeed(Clock.Clock)({
    currentTimeMillisUnsafe: () => clock.now(),
    currentTimeMillis: Effect.sync(() => clock.now()),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) =>
      Effect.callback<void>((resume) => {
        const cancel = clock.schedule(Duration.toMillis(duration), () => resume(Effect.void))

        return Effect.sync(cancel)
      }),
  })
}

/**
 * The cadence written on Effect behind the same port as `createCadence`: the same passes at the
 * same times over the injected clock, bridged into Effect's `Clock` service. Effect stays inside.
 */
export function createEffectCadence(
  clock: ReplicaClock,
  pass: (kind: PassKind) => Promise<void>,
): CadencePort {
  const runtime = ManagedRuntime.make(clockLayer(clock))
  // Not `Effect.promise`: it turns a rejection into a defect that would end the cadence without a
  // word. As in the light cadence, a rejected pass surfaces as an unhandled rejection instead,
  // and the passes go on.
  const passOnEffect = (kind: PassKind) =>
    Effect.callback<void>((resume) => {
      void pass(kind).finally(() => resume(Effect.void))
    })
  const cadence = runtime.runSync(makeCadence(passOnEffect))
  const run = (program: Effect.Effect<void>): void => {
    runtime.runFork(program)
  }

  return {
    start: () => run(cadence.start),
    stop: () => run(cadence.stop),
    visibility: (state) => run(cadence.visibility(state)),
    channel: (state) => run(cadence.channel(state)),
  }
}
