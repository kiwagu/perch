import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'

import type { ClientMessage } from '../protocol'
import { RegionDoc } from '../region-doc'
import { manualClock } from '../testing'

import { regionId } from './__fixtures__/devices'
import { serverHistory } from './__fixtures__/server-history'
import { RegionPull } from './region-pull'

/** A region's pull over a channel that is always up, under a subscription, keeping what was sent. */
function pullAlone() {
  const sent: ClientMessage[] = []
  const errors: DataError[] = []
  const pull = new RegionPull({
    region: RegionDoc.inMemory('private', regionId),
    transport: {
      send(message) {
        sent.push(message)

        return true
      },
      reconnect() {},
    },
    clock: manualClock(),
    onSettled: () => {},
    onError: (error) => errors.push(error),
    subscribed: () => true,
  })

  return { pull, errors, pulls: () => sent.filter(({ type }) => type === 'pull').length }
}

describe('whether a region pull caught up', () => {
  it('is not caught up while a pull is out, until its answer is imported', async () => {
    const { pull, pulls } = pullAlone()
    const { all } = serverHistory()

    pull.request()

    expect(pulls()).toBe(1)
    expect(pull.caughtUp()).toBe(false)

    pull.end()
    await pull.imported(all, 2, true)

    expect(pull.caughtUp()).toBe(true)
  })

  it('is not caught up while an import leaves updates waiting for their history', async () => {
    const { pull, pulls } = pullAlone()
    const { gap, all } = serverHistory()

    expect(pull.caughtUp()).toBe(true)

    await pull.imported(gap, 2, true)

    expect(pulls()).toBe(1)
    expect(pull.caughtUp()).toBe(false)

    // The pull is answered: it is no longer out, and what it brought completes the history.
    pull.end()

    expect(pull.caughtUp()).toBe(false)

    await pull.imported(all, 2, true)

    expect(pull.caughtUp()).toBe(true)
  })

  it('stays behind after a failed import until the answer to a pull imports in full, whatever imports meanwhile', async () => {
    const { pull, pulls, errors } = pullAlone()
    const { all } = serverHistory()

    await pull.imported(new Uint8Array([1, 2, 3]), 1, true)

    expect(errors).toEqual([expect.objectContaining({ code: 'data:WRITE_REJECTED' })])
    expect(pulls()).toBe(1)
    expect(pull.caughtUp()).toBe(false)

    // An update that answers no request imports cleanly, and the region still lacks what was lost.
    pull.end()
    await pull.imported(all, 2, false)

    expect(pull.caughtUp()).toBe(false)

    pull.retry()

    expect(pulls()).toBe(2)

    pull.end()
    await pull.imported(all, 2, true)

    expect(pull.caughtUp()).toBe(true)
  })
})
