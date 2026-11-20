import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { createLogger } from '@workspace/logger'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { MembershipRetells } from './retells'
import { MembershipTurns } from './turns'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

/** A tell of `identity` that failed, as a failing read of the directory answers it. */
const failure = (identity: IdentityId): DataError =>
  dataError('data:QUERY_FAILED', `could not read the memberships of ${identity}`)

/** One answer of a try, made when the try is asked for. */
type Answer = () => ResultAsync<void, DataError>

/** A try that answers only once `release` is called, then with `outcome`. */
function heldAnswer(outcome: Result<void, DataError>) {
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const answer: Answer = () => new ResultAsync(released.then(() => outcome))

  return { answer, release }
}

/** Lets every promise callback queued so far, and those they queue, run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Moves `clock` to `ms` since its start and lets what the tasks due on the way queued run. */
async function reach(clock: ManualClock, ms: number): Promise<void> {
  await clock.advance(ms - clock.now())
  await flush()
}

interface HarnessOptions {
  /** The jitter drawn for every delay; the middle of its range unless named. */
  readonly random?: () => number
  /** The answers of each identity's tries in turn; past them a try fails. */
  readonly answers?: ReadonlyMap<IdentityId, readonly Answer[]>
}

/**
 * The pending re-tells over a real `MembershipTurns` and a manual clock, with tries that answer as
 * scripted and record who was tried when, and a real logger whose lines are kept parsed.
 */
function harness(options: HarnessOptions = {}) {
  const clock = manualClock()
  const turns = new MembershipTurns()
  const answers = new Map<IdentityId, Answer[]>()

  for (const [identity, queued] of options.answers ?? []) {
    answers.set(identity, [...queued])
  }

  const tries: Array<{ readonly identity: IdentityId; readonly at: number }> = []
  const written: string[] = []
  const log = createLogger('organisations', {
    level: 'error',
    format: 'json',
    destination: { write: (line) => written.push(line) },
  })
  const retells = new MembershipRetells({
    clock,
    random: options.random ?? (() => 0.5),
    log,
    turns,
    attempt: (identity) => {
      tries.push({ identity, at: clock.now() })

      const next = answers.get(identity)?.shift()

      return next === undefined ? errAsync(failure(identity)) : next()
    },
  })

  /** Settles a tell of `identity` with `outcome` inside its turn, as a change does. */
  const told = (identity: IdentityId, outcome: Result<void, DataError>): Promise<void> =>
    turns
      .ofIdentity(identity, () => {
        retells.settled(identity, outcome)

        return okAsync(undefined)
      })
      .match(
        () => undefined,
        () => undefined,
      )

  /** Holds `identity`'s turn until `release`, then runs `inside` in it, as a slow change does. */
  const hold = (identity: IdentityId, inside: () => void = () => {}) => {
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const change: Promise<void> = turns
      .ofIdentity(identity, () => new ResultAsync(released.then(() => ok(inside()))))
      .match(
        () => undefined,
        () => undefined,
      )

    return { change, release }
  }

  /** The lines logged so far, parsed. */
  const logged = () => written.map((line) => JSON.parse(line) as Record<string, unknown>)

  return {
    clock,
    retells,
    tries,
    told,
    hold,
    logged,
    /** The code and the attempt of each line logged so far. */
    lines: () => logged().map((line) => ({ code: line['code'], attempt: line['attempt'] })),
  }
}

/** Whether `promise` has settled once the callbacks queued so far ran. */
async function settledYet(promise: Promise<void>): Promise<() => boolean> {
  let settled = false

  void promise.then(() => {
    settled = true
  })
  await flush()

  return () => settled
}

describe('MembershipRetells', () => {
  it('a failure arms the first retell after 1 s times the jitter', async () => {
    const low = harness({ random: () => 0 })

    await low.told(ann, err(failure(ann)))
    await reach(low.clock, 799)
    expect(low.tries).toEqual([])

    await reach(low.clock, 800)
    expect(low.tries).toEqual([{ identity: ann, at: 800 }])

    const high = harness({ random: () => 1 })

    await high.told(ann, err(failure(ann)))
    await reach(high.clock, 1_199)
    expect(high.tries).toEqual([])

    await reach(high.clock, 1_200)
    expect(high.tries).toEqual([{ identity: ann, at: 1_200 }])
  })

  it('the delays grow 1, 2, 4, 8, 16, 30 s and 30 s repeats', async () => {
    const { clock, tries, told } = harness({ random: () => 0.5 })
    const expected = [1_000, 3_000, 7_000, 15_000, 31_000, 61_000, 91_000]

    await told(ann, err(failure(ann)))

    for (const [index, at] of expected.entries()) {
      await reach(clock, at - 1)
      expect(tries).toHaveLength(index)

      await reach(clock, at)
      expect(tries).toHaveLength(index + 1)
    }

    expect(tries.map((tried) => tried.at)).toEqual(expected)
  })

  it('a success of any tell deletes the entry', async () => {
    const { clock, retells, tries, told } = harness()

    await told(ann, err(failure(ann)))
    await told(ann, ok(undefined))

    expect(retells.size).toBe(0)
    expect(clock.pending()).toBe(0)

    await reach(clock, 60_000)
    expect(tries).toEqual([])
  })

  it('one entry per identity under repeated failures', async () => {
    const { clock, retells, tries, told, lines } = harness()

    await told(ann, err(failure(ann)))
    await reach(clock, 300)
    await told(ann, err(failure(ann)))
    await told(ann, err(failure(ann)))

    expect(retells.size).toBe(1)
    expect(lines()).toHaveLength(1)

    await reach(clock, 999)
    expect(tries).toEqual([])

    await reach(clock, 1_000)
    expect(tries).toEqual([{ identity: ann, at: 1_000 }])
  })

  it('identities are retold independently', async () => {
    const { clock, retells, tries, told } = harness({
      answers: new Map([
        [ann, [() => errAsync(failure(ann))]],
        [bob, [() => okAsync(undefined)]],
      ]),
    })

    await told(ann, err(failure(ann)))
    await told(bob, err(failure(bob)))
    expect(retells.size).toBe(2)

    await reach(clock, 1_000)
    expect(tries).toEqual([
      { identity: ann, at: 1_000 },
      { identity: bob, at: 1_000 },
    ])
    expect(retells.size).toBe(1)

    await reach(clock, 3_000)
    expect(tries.slice(2)).toEqual([{ identity: ann, at: 3_000 }])
  })

  it('a retell queued behind a change whose tell succeeds does nothing', async () => {
    const { clock, retells, tries, told, hold } = harness()

    await told(ann, err(failure(ann)))

    const held = hold(ann, () => retells.settled(ann, ok(undefined)))

    await reach(clock, 1_000)
    expect(clock.pending()).toBe(0)

    held.release()
    await held.change
    await flush()

    expect(tries).toEqual([])
    expect(retells.size).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  it('a change failing while its retell waits in the turn keeps that retell', async () => {
    const { clock, retells, tries, told, hold, lines } = harness()

    await told(ann, err(failure(ann)))

    const held = hold(ann, () => retells.settled(ann, err(failure(ann))))

    await reach(clock, 1_000)
    expect(tries).toEqual([])

    held.release()
    await held.change
    await flush()

    expect(tries).toEqual([{ identity: ann, at: 1_000 }])
    expect(lines().map((line) => line.attempt)).toEqual([0, 1])
    expect(retells.size).toBe(1)
    expect(clock.pending()).toBe(1)
  })

  it('a retell whose entry was made anew while it waited in the turn does nothing', async () => {
    const { clock, retells, tries, told, hold } = harness()

    await told(ann, err(failure(ann)))

    const succeeding = hold(ann, () => retells.settled(ann, ok(undefined)))
    const failing = told(ann, err(failure(ann)))

    await reach(clock, 1_000)
    succeeding.release()
    await succeeding.change
    await failing
    await flush()

    expect(tries).toEqual([])
    expect(retells.size).toBe(1)
    expect(clock.pending()).toBe(1)

    await reach(clock, 1_999)
    expect(tries).toEqual([])

    await reach(clock, 2_000)
    expect(tries).toEqual([{ identity: ann, at: 2_000 }])
  })

  it('close while a retell runs: no rearm, nothing after, close resolves once it settled', async () => {
    const running = heldAnswer(err(failure(ann)))
    const { clock, retells, tries, told, lines } = harness({
      answers: new Map([[ann, [running.answer]]]),
    })

    await told(ann, err(failure(ann)))
    await reach(clock, 1_000)
    expect(tries).toHaveLength(1)

    const closed = await settledYet(retells.close())

    expect(closed()).toBe(false)

    running.release()
    await flush()
    expect(closed()).toBe(true)

    expect(retells.size).toBe(0)
    expect(clock.pending()).toBe(0)
    expect(lines()).toHaveLength(1)

    await reach(clock, 121_000)
    expect(tries).toHaveLength(1)
  })

  it('close resolves while a retell is still queued behind a held change, and that retell then does nothing', async () => {
    const { clock, retells, tries, told, hold } = harness()

    await told(ann, err(failure(ann)))

    const held = hold(ann)

    await reach(clock, 1_000)

    const closed = await settledYet(retells.close())

    expect(closed()).toBe(true)

    held.release()
    await held.change
    await flush()

    expect(tries).toEqual([])
    expect(retells.size).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  it('close awaits every running retell, of any identity', async () => {
    const annRunning = heldAnswer(err(failure(ann)))
    const bobRunning = heldAnswer(ok(undefined))
    const { clock, retells, tries, told } = harness({
      answers: new Map([
        [ann, [annRunning.answer]],
        [bob, [bobRunning.answer]],
      ]),
    })

    await told(ann, err(failure(ann)))
    await told(bob, err(failure(bob)))
    await reach(clock, 1_000)
    expect(tries).toHaveLength(2)

    const closed = await settledYet(retells.close())

    expect(closed()).toBe(false)

    annRunning.release()
    await flush()
    expect(closed()).toBe(false)

    bobRunning.release()
    await flush()
    expect(closed()).toBe(true)
  })

  it('close cancels armed timers and a tell after close arms nothing', async () => {
    const { clock, retells, tries, told, lines } = harness()

    await told(ann, err(failure(ann)))
    expect(clock.pending()).toBe(1)

    await retells.close()
    expect(clock.pending()).toBe(0)
    expect(retells.size).toBe(0)

    await told(bob, err(failure(bob)))
    expect(retells.size).toBe(0)
    expect(clock.pending()).toBe(0)
    expect(lines()).toHaveLength(1)

    await reach(clock, 60_000)
    expect(tries).toEqual([])
  })

  it('logs once when the entry is made and once per failed retell', async () => {
    const { clock, told, lines, logged } = harness()

    await told(ann, err(failure(ann)))
    await reach(clock, 1_000)

    expect(lines()).toEqual([
      { code: 'data:QUERY_FAILED', attempt: 0 },
      { code: 'data:QUERY_FAILED', attempt: 1 },
    ])
    expect(logged().map((line) => line['msg'])).toEqual([
      failure(ann).message,
      failure(ann).message,
    ])
  })

  it('a retell whose try throws counts as a failed retell', async () => {
    const { clock, retells, tries, told, lines } = harness({
      answers: new Map([
        [
          ann,
          [
            () => {
              throw new Error(`the directory is down for ${ann}`)
            },
          ],
        ],
      ]),
    })

    await told(ann, err(failure(ann)))
    await reach(clock, 1_000)
    expect(tries).toHaveLength(1)

    expect(lines()).toEqual([
      { code: 'data:QUERY_FAILED', attempt: 0 },
      { code: 'data:WRITE_FAILED', attempt: 1 },
    ])
    expect(retells.size).toBe(1)
    expect(clock.pending()).toBe(1)

    await reach(clock, 3_000)
    expect(tries).toHaveLength(2)
  })
})
