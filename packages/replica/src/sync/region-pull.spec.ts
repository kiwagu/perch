import { afterEach, describe, expect, it } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'

import type { ClientMessage } from '../protocol'
import { RegionDoc } from '../region-doc'
import appendStatement from '../surql/replica-append.surql'
import importStatement from '../surql/replica-import.surql'
import { manualClock } from '../testing'

import { regionId, writeName } from './__fixtures__/devices'
import { serverHistory } from './__fixtures__/server-history'
import { RegionPull } from './region-pull'

/** A region's pull over a channel that is always up, under a subscription, keeping what was sent. */
function pullAlone(region: RegionDoc = RegionDoc.inMemory('private', regionId)) {
  const sent: ClientMessage[] = []
  const errors: DataError[] = []
  const resubscribed = { count: 0 }
  const pull = new RegionPull({
    region,
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
    resubscribe: () => {
      resubscribed.count += 1
    },
  })

  return {
    pull,
    errors,
    pulls: () => sent.filter(({ type }) => type === 'pull').length,
    resubscriptions: () => resubscribed.count,
  }
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

  it('stays behind after a failed import, subscribing again, until the answer to a subscription imports in full', async () => {
    const { pull, pulls, resubscriptions, errors } = pullAlone()
    const { all, snapshot } = serverHistory()

    await pull.imported(new Uint8Array([1, 2, 3]), 1, true)

    expect(errors).toEqual([expect.objectContaining({ code: 'data:WRITE_REJECTED' })])
    expect(resubscriptions()).toBe(1)
    expect(pulls()).toBe(0)
    expect(pull.caughtUp()).toBe(false)

    // An update that answers no subscription imports in full, and the region still lacks what was lost.
    await pull.imported(all, 2, false)

    expect(pull.caughtUp()).toBe(false)

    pull.retry()

    expect(resubscriptions()).toBe(2)
    expect(pulls()).toBe(0)

    await pull.imported(snapshot, 2, true)

    expect(pull.caughtUp()).toBe(true)

    pull.retry()

    expect(resubscriptions()).toBe(2)
  })
})

describe('what a region pull reports of a failed import', () => {
  const databases: LocalDb[] = []

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()))
  })

  /** The region on a database whose queries pass `before` first, as `interceptQueries` takes it. */
  async function regionOn(before: (text: string) => void | Promise<void>): Promise<RegionDoc> {
    const database = (await openTestDb())._unsafeUnwrap()

    databases.push(database)

    return (
      await RegionDoc.open(interceptQueries(database, before), { kind: 'private', id: regionId })
    )._unsafeUnwrap()
  }

  /** A region holding a local update that failed to persist: its database refuses every append. */
  async function holdingAnUnstoredUpdate(): Promise<RegionDoc> {
    const region = await regionOn((text) => {
      if (text === appendStatement) {
        throw new Error('the disk is full')
      }
    })

    writeName(region, 'Ann')
    expect((await region.flush()).isErr()).toBe(true)

    return region
  }

  it('reports nothing of the updates a local update that failed to persist holds back, and subscribes again once', async () => {
    const { pull, errors, resubscriptions } = pullAlone(await holdingAnUnstoredUpdate())
    const { all } = serverHistory()

    await pull.imported(all, 2, true)
    await pull.imported(all, 2, false)

    expect(errors).toEqual([])
    expect(resubscriptions()).toBe(1)
    expect(pull.caughtUp()).toBe(false)
  })

  it('still reports an update that does not decode while a local update is unstored', async () => {
    const { pull, errors, resubscriptions } = pullAlone(await holdingAnUnstoredUpdate())

    await pull.imported(new Uint8Array([1, 2, 3]), 1, true)

    expect(errors).toEqual([expect.objectContaining({ code: 'data:WRITE_REJECTED' })])
    expect(resubscriptions()).toBe(1)
  })

  it('reports an update whose own storing failed, though a local update failed to persist meanwhile', async () => {
    let failAppends = false
    let reach = (): void => {}
    let release = (): void => {}
    const reached = new Promise<void>((resolve) => {
      reach = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const region = await regionOn(async (text) => {
      if (failAppends && text === appendStatement) {
        throw new Error('the disk is full')
      }

      if (text === importStatement) {
        reach()
        await released

        throw new Error('the disk is full')
      }
    })
    const { pull, errors } = pullAlone(region)
    const importing = pull.imported(serverHistory().all, 2, true)

    // The server's update passed the local updates and waits to be stored when a local one fails.
    await reached
    failAppends = true
    writeName(region, 'Ann')
    expect((await region.flush()).isErr()).toBe(true)
    release()
    await importing

    expect(errors).toEqual([
      expect.objectContaining({ message: `could not persist a server update of ${regionId}` }),
    ])
  })
})
