import { ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { type DataError, type LocalDb, openLocalDb, tenantDatabase } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema } from '@workspace/data/testing'
import { manualClock } from '@workspace/replica/testing'

import { NAMESPACE } from '../config'

import { TenantDatabases } from './tenant-databases'

/** An organisation's database on an embedded in-memory engine of its own, with the tenant schema. */
function openEmbedded(key = 'test') {
  return openLocalDb({
    engines: nodeEngines(),
    url: 'mem://',
    namespace: NAMESPACE,
    database: tenantDatabase(key),
    schema: readSchema('tenant'),
  })
}

/** Opens embedded databases that record themselves in `closed` when they close. */
function recordingOpen(closed: LocalDb[]) {
  return vi.fn(() =>
    openEmbedded().map((local) => {
      const recorded: LocalDb = {
        ...local,
        close: async () => {
          closed.push(recorded)
          await local.close()
        },
      }

      return recorded
    }),
  )
}

describe('TenantDatabases', () => {
  it('opens a database once and hands the same one to every holder', async () => {
    const open = vi.fn(() => openEmbedded())
    const databases = new TenantDatabases({ open, clock: manualClock(), onError: () => {} })
    const first = (await databases.acquire('acme'))._unsafeUnwrap()
    const second = (await databases.acquire('acme'))._unsafeUnwrap()

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('acme')
    expect(second.local).toBe(first.local)
    first.release()
    second.release()
    await databases.close()
  })

  it('closes a database nobody holds after the idle time, and opens it again on the next acquire', async () => {
    const closed: LocalDb[] = []
    const open = recordingOpen(closed)
    const clock = manualClock()
    const databases = new TenantDatabases({ open, clock, idleCloseMs: 1_000, onError: () => {} })
    const handle = (await databases.acquire('acme'))._unsafeUnwrap()

    handle.release()
    await clock.advance(999)
    expect(closed).toHaveLength(0)
    await clock.advance(1)
    await vi.waitFor(() => expect(closed).toHaveLength(1))
    ;(await databases.acquire('acme'))._unsafeUnwrap().release()
    expect(open).toHaveBeenCalledTimes(2)
    await databases.close()
  })

  it('keeps a database open while a holder remains', async () => {
    const closed: LocalDb[] = []
    const clock = manualClock()
    const databases = new TenantDatabases({
      open: recordingOpen(closed),
      clock,
      idleCloseMs: 1_000,
      onError: () => {},
    })
    const first = (await databases.acquire('acme'))._unsafeUnwrap()
    const second = (await databases.acquire('acme'))._unsafeUnwrap()

    first.release()
    // A second release of the same handle does not let the other holder's database go.
    first.release()
    await clock.advance(5_000)
    expect(closed).toEqual([])
    second.release()
    await clock.advance(1_000)
    await vi.waitFor(() => expect(closed).toEqual([second.local]))
    await databases.close()
  })

  it('reports an open that fails and answers the holder with the error', async () => {
    const reported: DataError[] = []
    const failing = new TenantDatabases({
      open: () =>
        openLocalDb({
          engines: nodeEngines(),
          url: 'nope://',
          namespace: NAMESPACE,
          database: tenantDatabase('acme'),
          schema: '',
        }),
      clock: manualClock(),
      onError: (error) => reported.push(error),
    })
    const result = await failing.acquire('acme')

    expect(result.isErr() && result.error.code).toBe('data:OPEN_FAILED')
    expect(reported.map((error) => error.code)).toEqual(['data:OPEN_FAILED'])
    await failing.close()
  })

  it('closes every database it holds on close, held or not', async () => {
    const closed: LocalDb[] = []
    const clock = manualClock()
    const databases = new TenantDatabases({
      open: recordingOpen(closed),
      clock,
      onError: () => {},
    })
    const acme = (await databases.acquire('acme'))._unsafeUnwrap()
    const globex = (await databases.acquire('globex'))._unsafeUnwrap()

    globex.release()
    await databases.close()

    expect(closed).toHaveLength(2)
    expect(clock.pending()).toBe(0)
    acme.release()
    expect(clock.pending()).toBe(0)
  })

  it('forgets a cached database on evict, opens a new one on the next acquire and closes the old one once released', async () => {
    const closed: LocalDb[] = []
    const open = recordingOpen(closed)
    const clock = manualClock()
    const databases = new TenantDatabases({ open, clock, idleCloseMs: 1_000, onError: () => {} })
    const held = (await databases.acquire('acme'))._unsafeUnwrap()

    databases.evict('acme')
    databases.evict('acme')
    databases.evict('globex')
    // Held by someone: still open.
    expect(closed).toEqual([])

    const fresh = (await databases.acquire('acme'))._unsafeUnwrap()

    expect(open).toHaveBeenCalledTimes(2)
    expect(fresh.local).not.toBe(held.local)
    held.release()
    await vi.waitFor(() => expect(closed).toEqual([held.local]))
    fresh.release()
    await databases.close()
    expect(closed).toHaveLength(2)
  })

  it('evicts a database waiting out its idle time without closing it twice', async () => {
    const closed: LocalDb[] = []
    const clock = manualClock()
    const databases = new TenantDatabases({
      open: recordingOpen(closed),
      clock,
      idleCloseMs: 1_000,
      onError: () => {},
    })
    const handle = (await databases.acquire('acme'))._unsafeUnwrap()

    handle.release()
    databases.evict('acme')
    await vi.waitFor(() => expect(closed).toEqual([handle.local]))
    expect(clock.pending()).toBe(0)
    await clock.advance(5_000)
    await databases.close()
    expect(closed).toHaveLength(1)
  })

  it('keeps a database acquired again before its idle time ran out, the same one', async () => {
    const closed: LocalDb[] = []
    const open = recordingOpen(closed)
    const clock = manualClock()
    const databases = new TenantDatabases({ open, clock, idleCloseMs: 1_000, onError: () => {} })
    const first = (await databases.acquire('acme'))._unsafeUnwrap()

    first.release()
    await clock.advance(500)

    const again = (await databases.acquire('acme'))._unsafeUnwrap()

    await clock.advance(5_000)
    expect(again.local).toBe(first.local)
    expect(open).toHaveBeenCalledTimes(1)
    expect(closed).toEqual([])
    again.release()
    await clock.advance(1_000)
    await vi.waitFor(() => expect(closed).toEqual([again.local]))
    await databases.close()
  })

  it('opens a new connection for an acquire that comes while the idle close is under way', async () => {
    const closed: LocalDb[] = []
    let letClose = () => {}
    const closeHeld = new Promise<void>((resolve) => {
      letClose = resolve
    })
    // Records each connection as it closes; the first one's close waits until the test lets it end.
    const open = vi.fn(() => {
      const held = open.mock.calls.length === 1

      return openEmbedded().map((local) => {
        const recorded: LocalDb = {
          ...local,
          close: async () => {
            if (held) {
              await closeHeld
            }

            closed.push(recorded)
            await local.close()
          },
        }

        return recorded
      })
    })
    const clock = manualClock()
    const databases = new TenantDatabases({ open, clock, idleCloseMs: 1_000, onError: () => {} })
    const first = (await databases.acquire('acme'))._unsafeUnwrap()

    first.release()
    await clock.advance(1_000)

    const next = (await databases.acquire('acme'))._unsafeUnwrap()

    expect(open).toHaveBeenCalledTimes(2)
    expect(next.local).not.toBe(first.local)
    expect(closed).toEqual([])
    letClose()
    await vi.waitFor(() => expect(closed).toEqual([first.local]))
    next.release()
    await databases.close()
    expect(closed).toHaveLength(2)
  })

  it('hands out no database once closed: an acquire after close and one whose open was under way are refused', async () => {
    const closed: LocalDb[] = []
    const opened = recordingOpen(closed)
    let letOpen = () => {}
    const openHeld = new Promise<void>((resolve) => {
      letOpen = resolve
    })
    const errors: DataError[] = []
    const databases = new TenantDatabases({
      open: () => ResultAsync.fromSafePromise(openHeld).andThen(() => opened()),
      clock: manualClock(),
      onError: (error) => errors.push(error),
    })
    const opening = databases.acquire('acme')
    const closing = databases.close()

    letOpen()
    expect((await opening)._unsafeUnwrapErr()).toMatchObject({ code: 'data:OPEN_FAILED' })
    await closing
    expect(closed).toHaveLength(1)
    expect((await databases.acquire('globex'))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:OPEN_FAILED',
    })
    expect(opened).toHaveBeenCalledTimes(1)
    // Being closed is no failure of a database.
    expect(errors).toEqual([])
  })
})
