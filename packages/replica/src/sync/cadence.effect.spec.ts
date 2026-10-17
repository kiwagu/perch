import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import type { PassKind } from './cadence'
import { describeCadence } from './cadence.contract'
import { createEffectCadence, makeCadence } from './cadence.effect'

describeCadence('cadence on Effect', createEffectCadence)

describe("cadence on Effect's TestClock", () => {
  it('probes and runs the full pass on time, and a stop waits for the pass under way', async () => {
    const started: PassKind[] = []
    const finished: PassKind[] = []
    // Every pass takes 20 seconds of the test clock.
    const pass = (kind: PassKind) =>
      Effect.gen(function* () {
        started.push(kind)
        yield* Effect.sleep('20 seconds')
        finished.push(kind)
      })

    const program = Effect.gen(function* () {
      const cadence = yield* makeCadence(pass)

      yield* cadence.channel('up')
      yield* cadence.start
      yield* TestClock.adjust('5 minutes')

      expect(started).toEqual(['probe', 'probe', 'probe', 'probe', 'full'])
      expect(finished).toEqual(['probe', 'probe', 'probe', 'probe'])

      const stopping = yield* Effect.forkChild(cadence.stop, { startImmediately: true })

      yield* TestClock.adjust('20 seconds')
      yield* Fiber.join(stopping)

      expect(finished).toEqual(['probe', 'probe', 'probe', 'probe', 'full'])

      yield* TestClock.adjust('10 minutes')

      expect(started).toHaveLength(5)
    })

    await Effect.runPromise(Effect.provide(program, TestClock.layer()))
  })
})
