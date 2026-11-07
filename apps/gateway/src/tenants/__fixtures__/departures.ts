/**
 * Departures of accounts over embedded databases, for the departure specs: organisations over a
 * directory with each organisation's database on an embedded engine of its own (a connection
 * opened anew after an eviction starts empty), three identities, and what a test reads back. A
 * test can make one statement fail or wait, on the directory or on the organisations' databases,
 * as a broken or slow database would, and count what was sent to the directory. The hub holds no
 * region here: it keeps which regions it was asked to retire, and a test can make that fail.
 */

import { errAsync, okAsync } from 'neverthrow'
import { expect } from 'vitest'

import {
  type DataError,
  dataError,
  type LocalDb,
  openLocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory, noteIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import identityRow from '../../auth/__fixtures__/identity-row.surql'
import { DIRECTORY, NAMESPACE } from '../../config'
import { AccountDeparture } from '../account-departure'
import { Organisations } from '../organisations'
import { TenantDatabases } from '../tenant-databases'

import directoryRows from './directory-rows.surql'
import { specInvitations } from './invitations'
import memberRows from './member-rows.surql'
import membershipRows from './membership-rows.surql'
import namespaceInfo from './namespace-info.surql'
import noteRows from './note-rows.surql'
import noteWrite from './note-write.surql'
import tenantRows from './tenant-rows.surql'

/** Closes what a test opened, the organisations' databases before the directory. */
const cleanups: Array<() => Promise<void>> = []

/** Failures of the tenant databases that no test expected. */
const failures: DataError[] = []

/** Closes what the test opened, last first, and checks no failure was left that it did not expect. */
export async function closeDepartures(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
}

/** A statement the databases hold until it is let go. */
interface Held {
  readonly text: string
  readonly gate: Promise<void>
  readonly reached: () => void
}

/** The organisations, a departure to ask `blocked`, ann, bob and cat, and the readers. */
export async function departureHarness() {
  const directory = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  const opened: string[] = []
  /** Every statement the organisations sent to the directory, in order. */
  const sent: string[] = []
  let refusedStatement: string | undefined
  let held: Held | undefined
  const hook = (text: string): void | Promise<void> => {
    if (text === refusedStatement) {
      throw new Error('the database refused the statement')
    }

    if (text === held?.text) {
      held.reached()

      return held.gate
    }
  }
  const databases = new TenantDatabases({
    open: (key) => {
      opened.push(key)

      return openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((local) => interceptQueries(local, hook))
    },
    clock: manualClock(),
    onError: (error) => failures.push(error),
  })

  cleanups.push(
    () => directory.close(),
    () => databases.close(),
  )

  let retireFails = false
  /** A hub that keeps each region it is asked to retire among the statements sent, in order. */
  const hub = {
    retire: (region: string) => {
      sent.push(`retire ${region}`)

      return retireFails
        ? errAsync(dataError('data:WRITE_FAILED', `could not release the database of ${region}`))
        : okAsync(undefined)
    },
  }
  const organisations = new Organisations({
    directory: interceptQueries(directory, (text) => {
      sent.push(text)

      return hook(text)
    }),
    databases,
    revoke: async () => {},
    rerole: async () => {},
    hub,
    invitations: specInvitations(directory),
  })
  const departure = new AccountDeparture({ directory, databases, hub })

  /** An identity written straight into the directory. */
  const identity = async (email: string): Promise<IdentityId> => {
    const key = identityIdFactory.create()

    await directory.db.query(identityRow, { key, email })

    return key
  }

  const ann = await identity('ann@example.test')
  const bob = await identity('bob@example.test')
  const cat = await identity('cat@example.test')

  /** Runs `work` on the organisation's database, holding it meanwhile. */
  const inTenant = async <T>(key: string, work: (local: LocalDb) => Promise<T>): Promise<T> => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      return await work(handle.local)
    } finally {
      handle.release()
    }
  }

  /** The directory's rows the statement `text` reads, with `bindings`. */
  const read = async <T>(text: string, bindings?: Record<string, unknown>): Promise<T[]> => {
    const [rows] = await directory.db.query<[T[]]>(text, bindings)

    return rows
  }

  return {
    organisations,
    departure,
    directory,
    opened,
    ann,
    bob,
    cat,

    /** `creator` creates the organisation `key`, for a test to start from. */
    founded: async (creator: IdentityId, key: string) =>
      (await organisations.create({ identity: creator, key, name: key }))._unsafeUnwrap(),

    /** `actor` invites the identity that signs in with `email` into `key`. */
    invited: async (actor: IdentityId, key: string, email: string) =>
      (await organisations.invite({ actor, key, email }))._unsafeUnwrap(),

    /** The members the organisation's own database holds, admins first. */
    membersIn: (key: string) =>
      inTenant(key, async (local) => {
        const [rows] = await local.db.query<[Array<{ identity: string; role: string }>]>(memberRows)

        return rows
      }),

    /** The notes the organisation's own database holds, with their authors. */
    notesIn: (key: string) =>
      inTenant(key, async (local) => {
        const [rows] = await local.db.query<[Array<{ author: string; text: string }>]>(noteRows)

        return rows
      }),

    /** `author` writes a note in the organisation's database. */
    noted: (key: string, author: IdentityId, text: string) =>
      inTenant(key, (local) =>
        local.db.query(noteWrite, { id: noteIdFactory.create(), author, text }),
      ),

    /** The definition of the organisation's database in the namespace, if it is defined. */
    definitionOf: async (key: string) => {
      const [namespace] =
        await directory.db.query<[{ databases: Record<string, string | undefined> }]>(namespaceInfo)

      return namespace.databases[tenantDatabase(key)]
    },

    /** The directory's row of the organisation with `key`, if any. */
    tenantRowOf: (key: string) => read<{ status: string }>(tenantRows, { key }),

    /** The roles `identity` holds in the organisation with `key`, by the directory. */
    rolesIn: async (identity: IdentityId, key: string) =>
      (
        await read<{ role: string }>(membershipRows, {
          identity: recordId('identity', identity),
          key,
        })
      ).map((row) => row.role),

    /** Every organisation's key and how many memberships the directory holds. */
    everything: async () => {
      const [tenants, memberships] =
        await directory.db.query<[Array<{ key: string }>, Array<{ role: string }>]>(directoryRows)

      return { tenants: tenants.map((row) => row.key).sort(), memberships: memberships.length }
    },

    /** How many times the organisations sent `statement` to the directory so far. */
    sentCount: (statement: string) => sent.filter((text) => text === statement).length,

    /**
     * What the organisations sent to the directory and the regions they asked the hub to retire
     * (`retire <region>`), in order, of what `kept` keeps.
     */
    sentOf: (kept: (text: string) => boolean) => sent.filter(kept),

    /** Every retire fails from now on, as a hub whose release throws; `false` lets them be. */
    failRetires: (fails: boolean) => {
      retireFails = fails
    },

    /** `statement` is refused from now on; `undefined` refuses none. */
    refuse: (statement: string | undefined) => {
      refusedStatement = statement
    },

    /**
     * `statement` waits until `release` is called, wherever it is sent; `waiting` resolves once
     * one waits.
     */
    hold: (statement: string) => {
      let release = () => {}
      let reached = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const waiting = new Promise<void>((resolve) => {
        reached = resolve
      })

      held = { text: statement, gate, reached }

      return {
        waiting,
        release: () => {
          held = undefined
          release()
        },
      }
    },
  }
}
