import { Effect, Fiber, Ref } from 'effect'

import type { DrainTarget, OutboxDrainPort } from './outbox-drain'

/**
 * The outbox drain written on Effect behind the same port as `createOutboxDrain`: pushes the
 * outbox one batch at a time until it is empty or the channel falls, and folds requests made
 * while a round runs into one more round after it. The rounds run in a fiber; `stop` interrupts
 * it, and the push under way still finishes because a push is uninterruptible.
 */
export function createEffectOutboxDrain(target: DrainTarget): OutboxDrainPort {
  const stopped = Ref.makeUnsafe(false)
  /** A request came while a round ran. */
  const again = Ref.makeUnsafe(false)
  /** The fiber running rounds, while one runs. */
  const draining = Ref.makeUnsafe<Fiber.Fiber<void> | undefined>(undefined)

  const push = Effect.uninterruptible(Effect.promise(() => target.pushNext()))

  /**
   * Pushes until the outbox is empty or the channel falls. A loop rather than `Effect.repeat`,
   * which sleeps 0 ms between pushes and so yields to the event loop before every batch.
   */
  const round = Effect.gen(function* () {
    let outcome = yield* push

    while (outcome === 'sent') {
      outcome = yield* push
    }
  })

  /** Runs rounds while requests keep coming; lets go of `draining` once none is waiting. */
  const rounds = Effect.gen(function* () {
    do {
      yield* Ref.set(again, false)
      yield* round
    } while (yield* Ref.get(again))

    yield* Ref.set(draining, undefined)
  })

  const request = Effect.gen(function* () {
    if (yield* Ref.get(stopped)) {
      return
    }

    if (yield* Ref.get(draining)) {
      return yield* Ref.set(again, true)
    }

    yield* Ref.set(draining, yield* Effect.forkDetach(rounds, { startImmediately: true }))
  })

  const stop = Effect.gen(function* () {
    yield* Ref.set(stopped, true)

    const fiber = yield* Ref.get(draining)

    if (fiber) {
      yield* Fiber.interrupt(fiber)
    }
  })

  const idle = Effect.gen(function* () {
    const fiber = yield* Ref.get(draining)

    if (fiber) {
      yield* Fiber.await(fiber)
    }
  })

  return {
    request: () => Effect.runSync(request),
    stop: () => {
      Effect.runFork(stop)
    },
    idle: () => Effect.runPromise(idle),
  }
}
