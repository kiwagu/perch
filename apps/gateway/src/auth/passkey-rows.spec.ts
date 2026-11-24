import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { selectionReads } from './__fixtures__/query-plan'
import {
  identifiersIn,
  identifiersOf,
  keptRows,
  passkeyCeremony,
  twoFactorChallenge,
  written,
} from './__fixtures__/verification'
import { PasskeyRows, RECLAIMED_PER_CEREMONY } from './passkey-rows'
import passkeyCeremoniesReclaimStatement from './surql/passkey-ceremonies-reclaim.surql'

const opened: LocalDb[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.close()))
})

async function directory(): Promise<LocalDb> {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()

  opened.push(local)

  return local
}

/** Rows of every kind a reclaim of passkey ceremonies must leave, expired or not. */
const others = [
  ...keptRows('a'),
  ...keptRows('b'),
  ...twoFactorChallenge('expired', -60),
  ...twoFactorChallenge('live', 5),
]

describe('PasskeyRows.reclaim', () => {
  it('deletes the passkey ceremonies of both kinds that expired over a minute ago, and no other row', async () => {
    const local = await directory()
    const expired = [
      passkeyCeremony('registration-old', 'registration', -10),
      passkeyCeremony('authentication-old', 'authentication', -2),
    ]
    const kept = [
      ...others,
      passkeyCeremony('registration-live', 'registration', 4),
      passkeyCeremony('authentication-recent', 'authentication', -0.5),
    ]

    await written(local, [...expired, ...kept])
    ;(await new PasskeyRows(local).reclaim())._unsafeUnwrap()

    expect(await identifiersIn(local)).toEqual(identifiersOf(kept))
  })

  it('reads the expired ceremonies through the index of their expiry, never the whole table: as many rows as it deletes', async () => {
    const local = await directory()
    const expired = Array.from({ length: 3 }, (_, at) =>
      passkeyCeremony(`authentication-${at}`, 'authentication', -5 - at),
    )

    // Many rows the read must not walk: expired rows of other kinds and live ceremonies.
    await written(local, [
      ...expired,
      ...Array.from({ length: 8 }, (_, at) => keptRows(`${at}`)).flat(),
      ...Array.from({ length: 8 }, (_, at) => twoFactorChallenge(`${at}`, -30)).flat(),
      ...Array.from({ length: 8 }, (_, at) => passkeyCeremony(`live-${at}`, 'authentication', 4)),
    ])

    const reads = await selectionReads(local, passkeyCeremoniesReclaimStatement, {
      limit: RECLAIMED_PER_CEREMONY,
    })

    expect(reads.map(({ operator, index, rows }) => ({ operator, index, rows }))).toEqual([
      { operator: 'IndexScan', index: 'verification_ceremony_expiry', rows: expired.length },
    ])
    // Only the passkey ceremonies that expired: the range of the index starts at their kind.
    expect(reads[0]?.access).toMatch(/^\['passkey'\] LessThan d'/)
  })
})
