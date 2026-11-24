import { afterEach, describe, expect, it } from 'vitest'

import { type DataError, type LocalDb, openLocalDb, tenantDatabase } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { interceptQueries, openTestDb, readSchema } from '@workspace/data/testing'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import organisationSettingsWrite from './__fixtures__/organisation-settings-write.surql'
import tenantInvited from './__fixtures__/tenant-invited.surql'
import { InvitedLanguage } from './invited-language'
import organisationLocaleStatement from './surql/organisation-locale.surql'
import { TenantDatabases } from './tenant-databases'

/**
 * The language an account an invitation creates starts in: the default of the organisation whose
 * pending invitation of the email is the newest among those that name one, read from that
 * organisation's own settings row; none when no organisation names one, when a read fails, or when
 * the lookup takes longer than its budget.
 */

const DAY_MS = 24 * 60 * 60 * 1_000
const BUDGET_MS = 250
const ANN = 'ann@example.test'

/** Closes what a test opened, the organisations' databases before the directory. */
const cleanups: Array<() => Promise<void>> = []
/** Failures of the tenant databases that no test expected. */
const failures: DataError[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
})

/** A statement the organisations' databases hold until `release`, once `reached`. */
interface Held {
  readonly reached: Promise<void>
  readonly release: () => void
}

function held(): Held & { readonly gate: Promise<void>; readonly reach: () => void } {
  let reach = () => {}
  let release = () => {}
  const reached = new Promise<void>((resolve) => {
    reach = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  return { reached, release, gate, reach }
}

async function harness() {
  const clock = manualClock(Date.UTC(2026, 10, 24))
  const directory: LocalDb = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()
  /** Whether the organisations' databases refuse the read of a settings row. */
  let refusing = false
  /** The read of a settings row the organisations' databases hold, if any. */
  let holding: ReturnType<typeof held> | undefined
  const databases = new TenantDatabases({
    open: (key) =>
      openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: NAMESPACE,
        database: tenantDatabase(key),
        schema: readSchema('tenant'),
      }).map((local) =>
        interceptQueries(local, (text) => {
          if (text !== organisationLocaleStatement) {
            return undefined
          }

          if (refusing) {
            throw new Error('the database refused the statement')
          }

          if (holding !== undefined) {
            holding.reach()

            return holding.gate
          }

          return undefined
        }),
      ),
    clock: manualClock(),
    onError: (error) => failures.push(error),
  })
  /** The organisations whose database a lookup let go of, in order. */
  const released: string[] = []
  const logged: Array<{ readonly code: string; readonly message: string }> = []

  cleanups.push(
    () => directory.close(),
    () => databases.close(),
  )

  const language = new InvitedLanguage({
    directory,
    databases: {
      acquire: (key) =>
        databases.acquire(key).map((handle) => ({
          local: handle.local,
          release: () => {
            released.push(key)
            handle.release()
          },
        })),
    },
    clock,
    log: { warn: (fields, message) => logged.push({ code: fields.code, message }) },
    budgetMs: BUDGET_MS,
  })

  /** Organisation `key` (ready unless `status` says otherwise) invited `email` `ago` ms ago. */
  const invited = async (
    key: string,
    { email = ANN, ago = 0, expiresIn = 7 * DAY_MS, status = 'ready' } = {},
  ) => {
    await directory.db.query(tenantInvited, {
      key,
      status,
      email,
      created: new Date(clock.now() - ago),
      expires: new Date(clock.now() + expiresIn),
    })
  }

  /** The settings row `id` (by default the organisation's own) of `key`, with `content`. */
  const settings = async (
    key: string,
    content: Record<string, unknown>,
    id = `ost_${key}`,
  ): Promise<void> => {
    const handle = (await databases.acquire(key))._unsafeUnwrap()

    try {
      await handle.local.db.query(organisationSettingsWrite, { id, content })
    } finally {
      handle.release()
    }
  }

  return {
    clock,
    language,
    invited,
    settings,
    released,
    logged,
    refuse: () => {
      refusing = true
    },
    hold: () => {
      holding = held()

      return holding
    },
  }
}

describe('InvitedLanguage', () => {
  it('names no language for an email no organisation invited', async () => {
    const { language } = await harness()

    expect(await language.of(ANN)).toBeUndefined()
  })

  it('names the default language of the organisation that invited the email', async () => {
    const { language, invited, settings, released } = await harness()

    await invited('acme')
    await settings('acme', { locale: 'es' })

    expect(await language.of(ANN)).toBe('es')
    expect(released).toEqual(['acme'])
  })

  it('passes over the newest invitations whose organisation names none, to an older one that does', async () => {
    const { language, invited, settings } = await harness()

    await invited('acme', { ago: 3_000 })
    await settings('acme', { locale: 'es' })
    await invited('globex', { ago: 2_000 })
    await settings('globex', {})
    await invited('initech', { ago: 1_000 })

    expect(await language.of(ANN)).toBe('es')
  })

  it('names the default of the newest invitation when several organisations name one', async () => {
    const { language, invited, settings } = await harness()

    await invited('acme', { ago: 2_000 })
    await settings('acme', { locale: 'es' })
    await invited('globex', { ago: 1_000 })
    await settings('globex', { locale: 'en' })

    expect(await language.of(ANN)).toBe('en')
  })

  it("reads the organisation's own row alone, never another row of its table", async () => {
    const { language, invited, settings } = await harness()

    await invited('acme')
    await settings('acme', { locale: 'es' }, 'ost_other')

    expect(await language.of(ANN)).toBeUndefined()
  })

  it('passes over an expired invitation and one of an organisation not ready', async () => {
    const { language, invited, settings } = await harness()

    await invited('acme', { expiresIn: -1 })
    await settings('acme', { locale: 'es' })
    await invited('globex', { status: 'provisioning' })
    await settings('globex', { locale: 'es' })

    expect(await language.of(ANN)).toBeUndefined()
  })

  it('finds an invitation of the email whatever its case', async () => {
    const { language, invited, settings } = await harness()

    await invited('acme')
    await settings('acme', { locale: 'es' })

    expect(await language.of('Ann@Example.test')).toBe('es')
  })

  it("names none when an organisation's database cannot be read, and logs it by the organisation", async () => {
    const { language, invited, settings, refuse, logged, released } = await harness()

    await invited('acme')
    await settings('acme', { locale: 'es' })
    refuse()

    expect(await language.of(ANN)).toBeUndefined()
    expect(logged).toEqual([
      {
        code: 'sign-up:STARTING_LANGUAGE_UNREADABLE',
        message: 'the default language of the organisation acme could not be read',
      },
    ])
    expect(released).toEqual(['acme'])
  })

  it('names none once the lookup outlasts its budget, and lets the database go when its read settles', async () => {
    const { clock, language, invited, settings, hold, logged, released } = await harness()

    await invited('acme')
    await settings('acme', { locale: 'es' })

    const read = hold()
    const named = language.of(ANN)

    await read.reached
    await clock.advance(BUDGET_MS)

    expect(await named).toBeUndefined()
    expect(logged.map((line) => line.code)).toEqual(['sign-up:STARTING_LANGUAGE_LATE'])
    expect(released).toEqual([])

    read.release()

    await expect.poll(() => released).toEqual(['acme'])
  })
})
